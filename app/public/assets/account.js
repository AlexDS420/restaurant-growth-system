/* Restaurant OS — Mi cuenta: seguimiento de pedidos, perfil y acceso de equipo */
import { api, toast, modal, fmtMoney, fmtDate, fmtClock, statusBadge, emptyState, esc } from '/assets/ui.js';

const $ = (s) => document.querySelector(s);
const el = (id) => document.getElementById(id);
const state = { me: null };

async function boot() {
  try {
    state.me = await api('/me');
    $('#btn-logout').classList.remove('hide');
    $('#btn-logout').onclick = async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); };
    renderAccount();
  } catch {
    renderLogin();
    renderTrack();
  }
}

/* ---------- Seguimiento por token ---------- */
function renderTrack() {
  $('#app').insertAdjacentHTML('beforeend', `<section class="section" style="padding-top:0"><div class="shell" style="max-width:520px">
    <form class="card" id="track-form"><h3>📦 Seguir mi pedido</h3>
      <div class="field"><label for="tk">Código de seguimiento (del ticket o QR)</label><input class="input" id="tk" name="tracking_code" autocomplete="off" spellcheck="false" placeholder="Ej. A7B3K9…" required></div>
      <button class="btn btn-accent btn-lg btn-block" id="tk-go" type="submit">Ver estado</button>
    </form><div id="tk-res" role="status" aria-live="polite" style="margin-top:16px"></div></div></section>`);
  el('track-form').onsubmit = (event) => { event.preventDefault(); track(); };
}
async function track() {
  const token = el('tk').value.trim();
  if (!token) return toast('Ingresa el código de seguimiento', 'err');
  const box = $('#tk-res');
  box.innerHTML = '<div class="skeleton" style="height:80px"></div>';
  try {
    const o = await api(`/public/orders/${token}`);
    box.innerHTML = `<div class="card">
      <div class="split"><div><h3 style="margin:0">Pedido #${o.order_number || o.id}</h3>
      <p class="muted" style="margin:6px 0 0">${fmtDate(o.placed_at)} · ${o.fulfillment_type === 'delivery' ? 'Delivery' : 'Recojo'} · ${fmtMoney(o.totals.total_minor)}</p></div>
      ${statusBadge(o.status)}</div>
      <div class="steps" style="margin-top:18px">${['Nuevo', 'Aceptado', 'En preparación', 'Listo', 'Entregado'].map((s, i) => {
        const idx = o.status === 'cancelled' ? -1 : ['pending', 'accepted', 'preparing', 'ready', 'completed'].indexOf(o.status);
        const cls = o.status === 'cancelled' ? '' : i < idx ? 'done' : i === idx ? 'active' : '';
        return `<div class="step ${cls}">${s}</div>`;
      }).join('')}</div>
      <div class="stack" style="margin-top:14px">${o.items.map((i) => `<div class="split" style="font-size:13px"><span>${i.qty} × ${esc(i.name)}</span><span class="num">${fmtMoney(i.line_total_minor)}</span></div>`).join('')}</div>
      <p class="help" style="margin-top:12px">Pago: ${o.payment_status === 'paid' ? 'Pagado ✓' : o.payment_status === 'refunded' ? 'Reembolsado' : o.payment_status === 'failed' ? 'Pago fallido' : 'Pendiente'}</p>
    </div>`;
  } catch (e) { box.innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`; }
}

/* ---------- Cuenta: vista general ---------- */
function renderAccount() {
  const me = state.me.user;
  const blocks = [];
  if (me.role === 'customer') {
    blocks.push(`<button class="btn btn-accent" data-sec="orders">Mis pedidos</button>`);
  } else {
    blocks.push(`<a class="btn btn-accent" href="/admin.html">Abrir panel de negocio</a><a class="btn btn-ghost" href="/storefront.html">Ver mi tienda</a>`);
  }
  blocks.push(`<button class="btn btn-ghost" data-sec="profile">Mi perfil</button>`);

  $('#app').innerHTML = `<section class="section"><div class="shell" style="max-width:760px">
    <div class="split" style="align-items:flex-end;margin-bottom:24px">
      <div><div class="badge ok">Sesión iniciada</div>
        <h1 style="margin:10px 0 4px">Hola, ${esc(me.name)}</h1>
        <p class="muted" style="margin:0">${esc(me.email)} · ${me.role === 'customer' ? 'Cliente' : 'Equipo de ' + esc(state.me.venue?.name || 'tu negocio')}</p></div>
      <div class="row">${blocks.join('')}</div>
    </div>
    <div id="account-body"></div></div></section>`;
  $('#app').querySelectorAll('[data-sec]').forEach((b) => b.onclick = () => {
    if (b.dataset.sec === 'orders') renderMyOrders();
    if (b.dataset.sec === 'profile') renderProfile();
  });
  if (me.role === 'customer') renderMyOrders(); else renderProfile();
}

async function renderMyOrders() {
  const body = $('#account-body');
  body.innerHTML = '<div class="skeleton" style="height:80px"></div>';
  let rows = [];
  try { rows = await api('/me/orders'); } catch { rows = []; }
  body.innerHTML = `<div class="card"><h3>Mis pedidos</h3>
    ${rows.length ? rows.map((o) => `<div class="split" style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div><strong>#${o.order_number || o.id}</strong> <span class="muted">· ${fmtDate(o.placed_at)} ${fmtClock(o.placed_at)}</span>
        <div class="muted" style="font-size:12px">${o.fulfillment_type === 'delivery' ? 'Delivery' : 'Recojo'} · ${fmtMoney(o.total_minor)}</div></div>
      <div class="row">${statusBadge(o.status)}${['pending', 'accepted', 'preparing', 'ready'].includes(o.status) ? `<button class="btn btn-ghost btn-sm" data-tk="${o.public_token}">Seguir</button>` : ''}</div></div>`).join('')
      : emptyState('🧾', 'Aún no tienes pedidos. Haz tu primer pedido desde el menú de tu restaurante favorito.')}
  </div>`;
  body.querySelectorAll('[data-tk]').forEach((b) => {
    b.onclick = () => { state._tk = b.dataset.tk; $('#app').innerHTML = '<div id="tk-res2"></div>'; $('#tk-res2').outerHTML = ''; renderTrack(); el('tk').value = state._tk; trackInto('#tk-res'); };
  });
}
async function trackInto(sel) {
  const box = document.querySelector(sel);
  box.innerHTML = '<div class="skeleton" style="height:80px"></div>';
  try {
    const o = await api(`/public/orders/${el('tk').value.trim()}`);
    box.innerHTML = `<div class="card"><div class="split"><div><h3 style="margin:0">Pedido #${o.order_number || o.id}</h3></div>${statusBadge(o.status)}</div>
      <div class="steps" style="margin-top:14px">${['Nuevo', 'Aceptado', 'En preparación', 'Listo', 'Entregado'].map((s, i) => {
        const idx = o.status === 'cancelled' ? -1 : ['pending', 'accepted', 'preparing', 'ready', 'completed'].indexOf(o.status);
        const cls = o.status === 'cancelled' ? '' : i < idx ? 'done' : i === idx ? 'active' : '';
        return `<div class="step ${cls}">${s}</div>`;
      }).join('')}</div><p class="help">Pago: ${o.payment_status === 'paid' ? 'Pagado ✓' : o.payment_status === 'refunded' ? 'Reembolsado' : o.payment_status === 'failed' ? 'Pago fallido' : 'Pendiente'}</p></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`; }
}

async function renderProfile() {
  const me = state.me.user;
  $('#account-body').innerHTML = `<div class="card"><h3>Mi perfil</h3>
    <div class="field"><label for="pf-name">Nombre</label><input class="input" id="pf-name" name="name" autocomplete="name" value="${esc(me.name)}"></div>
    <div class="field"><label for="pf-phone">Teléfono (para seguir tus pedidos)</label><input class="input" id="pf-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" value="${esc(me.phone || '')}"></div>
    <div class="field"><label for="pf-email">Correo</label><input class="input" id="pf-email" name="email" type="email" disabled value="${esc(me.email)}"></div>
    <button class="btn btn-accent" id="pf-save">Guardar cambios</button></div>`;
  el('pf-save').onclick = async (e) => { const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true;
    try { await api('/me', { method: 'PATCH', body: { name: el('pf-name').value.trim(), phone: el('pf-phone').value.trim() } }); toast('Perfil actualizado', 'ok'); state.me.user.name = el('pf-name').value; state.me.user.phone = el('pf-phone').value; btn.classList.remove('loading'); btn.disabled = false; } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
}

/* ---------- Login / registro de clientes ---------- */
function renderLogin() {
  $('#app').innerHTML = `<section class="section"><div class="shell" style="max-width:420px;text-align:center">
    <span style="font-size:38px" aria-hidden="true">👤</span><div class="page-kicker" style="margin-top:12px">Pedidos y perfil</div><h1 style="margin:6px 0 2px">Mi cuenta</h1><p class="muted">Accede como cliente o miembro del equipo.</p>
    <div class="card" id="authform" style="text-align:left;margin-top:20px"></div></div></section>`;
  login();
}
function login() {
  el('authform').innerHTML = `<form id="login-form"><div class="field"><label for="a-email">Correo</label><input class="input" id="a-email" name="email" type="email" autocomplete="email" spellcheck="false" required></div>
    <div class="field"><label for="a-pass">Contraseña</label><input class="input" id="a-pass" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn btn-accent btn-lg btn-block" id="a-go" type="submit">Iniciar sesión</button></form>`;
  el('login-form').onsubmit = async (e) => { e.preventDefault(); const btn = el('a-go'); btn.classList.add('loading'); btn.disabled = true;
    try { await api('/auth/login', { method: 'POST', body: { email: el('a-email').value.trim(), password: el('a-pass').value } }); location.reload(); } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
}

boot();
