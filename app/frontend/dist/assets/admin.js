/* Restaurant OS — panel de negocio (dashboard completo es-PE) */
import { api, toast, modal, fmtMoney, fmtDate, fmtClock, statusBadge, emptyState, skeletonRows, esc, esPE, elapsedLabel } from './ui.js';

const sectionFromUrl = () => new URL(location.href).searchParams.get('section') || 'hoy';
const state = { me: null, venue: null, sec: sectionFromUrl(), soundOn: true, orders: [], lastSoundAt: 0 };
const $ = (s) => document.querySelector(s);
const el = (id) => document.getElementById(id);
const debounce = (fn, wait = 250) => { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; };

const SECTIONS = [
  ['hoy', 'Hoy'], ['pedidos', 'Pedidos'], ['comanda', 'Comandas'], ['menu', 'Menú'], ['inventario', 'Inventario'],
  ['clientes', 'Clientes'], ['reservas', 'Reservas'], ['reseñas', 'Reseñas'], ['analitica', 'Analítica'],
  ['promociones', 'Promociones'], ['cupones', 'Cupones'], ['facturacion', 'Facturación'], ['equipo', 'Equipo'],
  ['auditoria', 'Auditoría'], ['config', 'Configuración'],
];
const PERM = {
  hoy: 'analytics.read', pedidos: 'orders.read', comanda: 'orders.read', menu: 'menu.read', inventario: 'inventory.manage',
  clientes: 'customers.read', reservas: 'reservations.read', reseñas: 'reviews.read', analitica: 'analytics.read',
  promociones: 'promotions.write', cupones: 'coupons.write', facturacion: 'billing.manage', equipo: 'team.manage',
  auditoria: 'audit.read', config: 'venue.manage',
};

async function boot() {
  try {
    state.me = await api('/me');
    bindShell();
    const requested = sectionFromUrl();
    const allowed = SECTIONS.some(([id]) => id === requested) && state.me.user.permissions.includes(PERM[requested]);
    go(allowed ? requested : 'hoy', { replace: true });
  }
  catch { renderLogin(); }
}

function bindShell() {
  $('#user-chip').classList.remove('hide'); $('#user-chip').textContent = `${state.me.user.name} · ${labelRole(state.me.user.role)}`;
  $('#btn-logout').classList.remove('hide');
  $('#btn-store').classList.remove('hide');
  $('#btn-store').href = `./carta.html?venue=${encodeURIComponent(state.venue?.slug || 'casa-aurora')}`;
  $('#btn-logout').onclick = async () => {
    try { await api('/auth/logout', { method: 'POST' }); }
    finally { location.href = './carta.html?venue=casa-aurora&section=carta'; }
  };
}

function labelRole(r) { return { owner: 'Dueño', manager: 'Gerente', kitchen: 'Cocina', cashier: 'Caja', marketing: 'Marketing', viewer: 'Solo lectura', platform_admin: 'Admin plataforma' }[r] || r; }

function navHtml() {
  return `<div class="sidebar-admin"><nav class="sidebar" aria-label="Navegación">
    ${SECTIONS.filter(([id]) => state.me.user.permissions.includes(PERM[id])).map(([id, label]) => `<a href="?section=${id}" data-sec="${id}" ${state.sec === id ? 'class="active" aria-current="page"' : ''}>${label}</a>`).join('')}
  </nav><main class="main" id="main"></main></div>`;
}
// Fallback de accesibilidad para formularios renderizados dinámicamente:
// garantiza nombre programático y una etiqueta anunciable aun en campos secundarios.
function enhanceFormControls(root = document) {
  root.querySelectorAll('input, select, textarea').forEach((control) => {
    if (!control.name) control.name = control.id || `field-${Math.random().toString(36).slice(2, 8)}`;
    const labelled = control.id && root.querySelector(`label[for="${CSS.escape(control.id)}"]`);
    if (!labelled && !control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby')) {
      const wrapperLabel = control.closest('label');
      const text = wrapperLabel?.textContent?.trim() || control.getAttribute('placeholder') || control.name;
      control.setAttribute('aria-label', text.replace(/\s+/g, ' ').trim());
    }
  });
}
function go(sec, { replace = false } = {}) {
  if (comandaTimer && sec !== 'comanda') { clearInterval(comandaTimer); comandaTimer = null; }
  state.sec = sec;
  const url = new URL(location.href);
  url.searchParams.set('section', sec);
  history[replace ? 'replaceState' : 'pushState']({ section: sec }, '', url);
  $('#view').innerHTML = navHtml();
  $('#view').querySelectorAll('[data-sec]').forEach((a) => a.onclick = (e) => { e.preventDefault(); go(a.dataset.sec); });
  const fn = { hoy: rHoy, pedidos: rPedidos, comanda: rComanda, menu: rMenu, inventario: rInventario, clientes: rClientes, reservas: rReservas, reseñas: rReseñas, analitica: rAnalitica, promociones: rPromos, cupones: rCupones, facturacion: rBilling, equipo: rEquipo, auditoria: rAuditoria, config: rConfig }[sec];
  fn?.().then(() => enhanceFormControls()).catch((e) => {
    if (e.code === 'FORBIDDEN' || e.code === 'AUTH_REQUIRED') { go('hoy', { replace: true }); return; }
    main().innerHTML = `<div class="error-state" role="alert"><div class="ico">⚠️</div><h2>No se pudo cargar esta sección</h2><p>${esc(e.message || esPE.errors.generic)}</p><button class="btn" id="retry-section">Intentar nuevamente</button></div>`;
    el('retry-section').onclick = () => go(sec, { replace: true });
  });
}
const main = () => $('#main');
window.addEventListener('popstate', () => {
  if (!state.me) return;
  const sec = sectionFromUrl();
  if (SECTIONS.some(([id]) => id === sec) && state.me.user.permissions.includes(PERM[sec])) go(sec, { replace: true });
});

/* ---------- HOY ---------- */
async function rHoy() {
  main().innerHTML = skeletonRows(6);
  const [an, ven] = await Promise.all([api('/analytics/summary?from=' + encodeURIComponent(new Date(Date.now() - 7 * 864e5).toISOString())), api('/venue')]);
  state.venue = ven;
  const t = an.today || {};
  main().innerHTML = `
    <div class="service-header"><div><div class="page-kicker">Centro de servicio</div><h1>Hoy en ${esc(ven.name)}</h1><p class="muted">${new Intl.DateTimeFormat('es-PE', { dateStyle: 'full' }).format(new Date())}</p></div><span class="badge ${ven.is_open ? 'ok' : 'warn'}">${ven.is_open ? 'Local abierto' : 'Fuera de horario'}</span></div>
    <div class="grid grid-3" style="margin:24px 0">
      ${metric('Ventas hoy', fmtMoney(t.revenue || 0), 'accent-value')}
      ${metric('Pedidos hoy', t.n || 0)}
      ${metric('Ticket promedio', fmtMoney(an.completed?.avg_ticket_minor || 0))}
    </div>
    <div class="grid grid-2">
      <div class="card"><h4>Requiere tu atención</h4>${an.attention?.length ? an.attention.map((a) => `<p class="muted">• ${esc(a.message)}</p>`).join('') : '<p class="muted">Todo en orden ✅</p>'}</div>
      <div class="card"><h4>Oportunidades</h4>${an.opportunities?.length ? an.opportunities.map((o) => `<p class="muted">• ${esc(o.message)}</p>`).join('') : '<p class="muted">Aún no hay suficiente data.</p>'}</div>
    </div>
    <div class="card" style="margin-top:20px"><h4>Completa tu configuración</h4>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:12px">
        ${onboardingChips(ven.onboarding)}
      </div></div>`;
}
function metric(label, value, cls = '') { return `<div class="card metric"><div class="label">${label}</div><div class="value ${cls} num">${value}</div></div>`; }
function onboardingChips(o) {
  const items = [['business_data', 'Datos del negocio'], ['hours', 'Horarios'], ['branding', 'Logo o portada'], ['first_category', 'Primera categoría'], ['first_product', 'Primer producto'], ['delivery_method', 'Método de entrega'], ['menu_published', 'Menú publicado'], ['qr_downloaded', 'QR descargado']];
  return items.map(([k, l]) => `<span class="badge ${o[k] ? 'ok' : ''}" style="justify-content:flex-start">${o[k] ? '✓' : '·'} ${l}</span>`).join('');
}

/* ---------- PEDIDOS ---------- */
async function rPedidos() {
  main().innerHTML = `<div class="split"><h2>Pedidos</h2></div>
    <div class="topbar">
      <select class="input" style="width:auto" id="f-status" name="status" aria-label="Filtrar por estado"><option value="">Todos los estados</option>${['pending', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'].map((s) => `<option value="${s}">${statusLabel(s)}</option>`).join('')}</select>
      <select class="input" style="width:auto" id="f-date" name="date" aria-label="Filtrar por fecha"><option value="">Cualquier fecha</option><option value="today">Hoy</option><option value="week">Últimos 7 días</option></select>
      <input class="input" style="width:auto;min-width:180px" id="f-q" name="search" aria-label="Buscar cliente o pedido" autocomplete="off" placeholder="Buscar cliente o pedido…">
    </div><div id="orders-box"><div class="skeleton" style="height:80px;margin-bottom:10px"></div></div>`;
  el('f-status').onchange = el('f-date').onchange = loadOrders;
  el('f-q').oninput = debounce(loadOrders);
  await loadOrders();
}
function statusLabel(s) { return ({ pending: 'Nuevo', accepted: 'Aceptado', preparing: 'En preparación', ready: 'Listo', completed: 'Entregado', cancelled: 'Cancelado' })[s] || s; }
async function loadOrders() {
  const qs = new URLSearchParams();
  if (el('f-status').value) qs.set('status', el('f-status').value);
  if (el('f-date').value) qs.set('date', el('f-date').value);
  if (el('f-q').value) qs.set('q', el('f-q').value);
  const rows = await api('/orders?' + qs);
  state.orders = rows;
  const box = $('#orders-box');
  if (!rows.length) { box.innerHTML = emptyState('📦', esPE.empty.orders); return; }
  box.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Cliente</th><th>Entrega</th><th>Estado</th><th>Pago</th><th>Total</th><th>Hora</th><th>Acciones</th></tr></thead>
    <tbody>${rows.map((o) => `<tr>
      <td class="num">#${o.id}</td><td><strong>${esc(o.customer.name)}</strong><div class="muted" style="font-size:12px">${esc(o.customer.phone)}</div></td>
      <td>${o.fulfillment_type === 'delivery' ? '🚚 ' + esc(o.address || '') : '🏪 Recojo'}</td>
      <td>${statusBadge(o.status)}</td><td>${statusBadge(o.payment_status)}</td>
      <td class="num"><strong>${fmtMoney(o.totals.total_minor)}</strong></td><td class="muted">${fmtClock(o.placed_at)}</td>
      <td><div class="actions">${orderActions(o)}<button class="btn btn-ghost btn-sm" data-detail="${o.id}">Ver</button></div></td></tr>`).join('')}</tbody></table></div>`;
  box.querySelectorAll('[data-detail]').forEach((b) => b.onclick = () => orderDetail(b.dataset.detail));
  box.querySelectorAll('[data-trans]').forEach((b) => b.onclick = () => trans(b.dataset.trans, b.dataset.id));
  box.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = () => trans('cancelled', b.dataset.id, true));
}
function orderActions(o) {
  const btns = [];
  if (o.status === 'pending') btns.push(`<button class="btn btn-sm" data-trans="accepted" data-id="${o.id}">${esPE.orders.accept}</button>`);
  if (o.status === 'accepted') btns.push(`<button class="btn btn-sm" data-trans="preparing" data-id="${o.id}">Comenzar</button>`);
  if (o.status === 'preparing') btns.push(`<button class="btn btn-sm" data-trans="ready" data-id="${o.id}">Listo</button>`);
  if (o.status === 'ready') btns.push(`<button class="btn btn-sm" data-trans="completed" data-id="${o.id}">Entregado</button>`);
  if (['pending', 'accepted', 'preparing', 'ready'].includes(o.status)) btns.push(`<button class="btn btn-danger btn-sm" data-cancel="${o.id}">Cancelar</button>`);
  return btns.join('');
}
async function trans(status, id, ask = false) {
  if (ask && !confirm('¿Cancelar este pedido? Si ya pagó, se reembolsará automáticamente.')) return;
  try { await api(`/orders/${id}/transition`, { method: 'POST', body: { status } }); toast('Estado actualizado', 'ok'); loadOrders(); }
  catch (e) { toast(e.message, 'err'); }
}
async function orderDetail(id) {
  const o = await api(`/orders/${id}`);
  const payments = await api(`/orders/${id}/payments`);
  const m = modal(`
    <h3>Pedido #${o.id} ${statusBadge(o.status)} ${statusBadge(o.payment_status)}</h3>
    <p class="muted">${fmtDate(o.placed_at)} · ${o.fulfillment_type === 'delivery' ? 'Delivery' : 'Recojo'} · ${esc(o.customer.name)} · ${esc(o.customer.phone)}</p>
    ${o.address ? `<p>🏠 ${esc(o.address)} ${o.reference ? '· ' + esc(o.reference) : ''}</p>` : ''}
    <div class="stack" style="margin:14px 0">${o.items.map((i) => `<div class="split"><span>${i.qty} × ${esc(i.name)} ${i.options?.length ? `<span class="muted" style="font-size:12px">(${esc(i.options.map((x) => x.name).join(', '))})</span>` : ''}</span><span class="num">${fmtMoney(i.line_total_minor)}</span></div>`).join('')}</div>
    <div class="stack muted" style="font-size:13px;border-top:1px solid var(--border);padding-top:12px">
      <div class="split"><span>Subtotal</span><span class="num">${fmtMoney(o.totals.subtotal_minor)}</span></div>
      ${o.totals.discount_minor ? `<div class="split"><span>Descuento</span><span class="num">-${fmtMoney(o.totals.discount_minor)}</span></div>` : ''}
      <div class="split"><span>Delivery / IGV</span><span class="num">${fmtMoney(o.totals.delivery_fee_minor)} / ${fmtMoney(o.totals.tax_minor)}</span></div>
      <div class="split" style="font-weight:600;color:var(--ink)"><span>Total</span><span class="num">${fmtMoney(o.totals.total_minor)}</span></div>
    </div>
    <div style="margin-top:12px">${payments.payments.map((p) => `<div class="split" style="font-size:13px"><span>Pago ${p.status} <span class="muted">(${p.provider})</span></span><span class="num">${fmtMoney(p.amount_minor)}</span></div>`).join('') || ''}</div>
    ${payments.refunds.length ? `<div class="stack" style="font-size:13px;color:var(--danger)">${payments.refunds.map((r) => `<span>Reembolso ${fmtMoney(r.amount_minor)} — ${esc(r.reason)}</span>`).join('')}</div>` : ''}
    ${['paid', 'partially_refunded'].includes(o.payment_status) && state.me.user.permissions.includes('orders.refund') ? `<button class="btn btn-danger" id="rf" style="margin-top:12px">Reembolsar</button>` : ''}
    <div class="stack" style="margin-top:16px;font-size:12px;color:var(--ink-40)">${o.history.map((h) => `<span>${fmtClock(h.created_at)} · ${statusLabel(h.status)} ${h.actor_name ? '— ' + esc(h.actor_name) : ''}</span>`).join('')}</div>`, { title: '' });
  m.body.querySelector('#rf')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true;
    try { await api(`/orders/${o.id}/refund`, { method: 'POST', body: { reason: 'Reembolso solicitado por el local' } }); toast('Reembolso procesado', 'ok'); m.close(); await loadOrders(); }
    catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; }
  });
}

/* ---------- COMANDAS ---------- */
let comandaTimer = null;
async function rComanda() {
  clearInterval(comandaTimer);
  try { const feats = await api('/venue'); state.venue = feats; } catch { /* sin permiso */ }
  main().innerHTML = `<div class="split"><h2>Comandas</h2>
    <div class="row"><button class="btn btn-ghost btn-sm" id="snd">🔔 ${state.soundOn ? 'Sonido on' : 'Sonido off'}</button><span class="muted small-caps" id="sync">—</span></div></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr));align-items:start" id="comanda-cols"></div>`;
  el('snd').onclick = () => { state.soundOn = !state.soundOn; el('snd').textContent = `🔔 ${state.soundOn ? 'Sonido on' : 'Sonido off'}`; };
  const tick = async () => {
    const rows = await api('/orders');
    const cols = ['pending', 'preparing', 'ready'].map((s) => rows.filter((o) => o.status === s));
    if (state.soundOn && cols[0].length > state._lastNew && cols[0].length > 0 && Date.now() - state.lastSoundAt > 15000) { beep(); state.lastSoundAt = Date.now(); }
    state._lastNew = cols[0].length;
    el('sync').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-PE') + ' · sincronización cada 5s';
    el('comanda-cols').innerHTML = [['pending', 'Nuevos'], ['preparing', 'En preparación'], ['ready', 'Listos']].map(([s, t], i) => `
      <div class="card"><h4 style="display:flex;justify-content:space-between">${t} ${cols[i].length ? `<span class="badge accent">${cols[i].length}</span>` : ''}</h4>
      ${cols[i].length ? cols[i].map((o) => `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div class="split"><strong>#${o.id}</strong><span class="muted num">${elapsedLabel(o.placed_at)}</span></div>
        <div class="muted" style="font-size:13px">${o.items.map((x) => `${x.qty}× ${esc(x.name)}${x.options?.length ? ' (' + esc(x.options.map((y) => y.name).join(', ')) + ')' : ''}`).join('<br>')}</div>
        <div style="margin-top:8px">${orderActions(o)}</div></div>`).join('') : `<p class="muted" style="font-size:13px;margin:0">Sin pedidos</p>`}</div>`).join('');
    el('comanda-cols').querySelectorAll('[data-trans]').forEach((b) => b.onclick = () => trans(b.dataset.trans, b.dataset.id));
    el('comanda-cols').querySelectorAll('[data-cancel]').forEach((b) => b.onclick = () => trans('cancelled', b.dataset.id, true));
  };
  tick(); comandaTimer = setInterval(tick, 5000);
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.frequency.value = 880; g.gain.value = 0.12;
    osc.start(); osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.5);
  } catch { /* sin audio */ }
}

/* ---------- MENÚ ---------- */
async function rMenu() {
  main().innerHTML = `<div class="split"><h2>Menú</h2><button class="btn btn-accent" id="np">${esPE.menu.new_product}</button></div>
    <div class="split" style="margin:16px 0"><h4 style="margin:0">Categorías</h4><button class="btn btn-ghost btn-sm" id="nc">Nueva categoría</button></div>
    <div class="row" id="cats-box" style="margin-bottom:20px"></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Estado</th><th>Acciones</th></tr></thead>
    <tbody id="prods-body"></tbody></table></div>`;
  const [cats, prods, groups] = await Promise.all([api('/menu/categories'), api('/menu/products'), api('/menu/option-groups')]);
  state.cats = cats; state.prods = prods; state.groups = groups;
  el('cats-box').innerHTML = cats.map((c) => `<span class="badge">${esc(c.name)} ${c.is_visible ? '' : '<span class="muted">(oculta)</span>'}</span>`).join(' ') || '<span class="muted">Sin categorías</span>';
  el('prods-body').innerHTML = prods.length ? prods.map((p) => `<tr>
    <td><span style="margin-right:6px">${p.emoji || '🍽️'}</span><strong>${esc(p.name)}</strong><div class="muted" style="font-size:12px">${esc(p.description || '').slice(0, 60)}</div></td>
    <td>${esc(p.category_name)}</td><td class="num">${fmtMoney(p.price_minor)}${p.promo_price_minor ? `<div class="muted" style="font-size:12px">Oferta ${fmtMoney(p.promo_price_minor)}</div>` : ''}</td>
    <td class="num">${p.track_stock ? p.stock_quantity : '—'}</td>
    <td>${p.is_available ? '<span class="badge ok">Disponible</span>' : '<span class="badge err">Agotado</span>'} ${p.is_visible ? '' : '<span class="badge">Oculto</span>'}</td>
    <td><div class="actions"><button class="btn btn-ghost btn-sm" data-edit="${p.id}">Editar</button>${p.track_stock ? `<button class="btn btn-ghost btn-sm" data-stock="${p.id}">Stock</button>` : ''}<button class="btn btn-danger btn-sm" data-del="${p.id}">Eliminar</button></div></td></tr>`).join('')
    : `<tr><td colspan="6">${emptyState('📋', esPE.empty.menu)}</td></tr>`;
  el('np').onclick = () => productForm();
  el('nc').onclick = () => catForm();
  el('prods-body').querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => productForm(b.dataset.edit));
  el('prods-body').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (confirm('¿Archivar este producto?')) { await api(`/menu/products/${b.dataset.del}`, { method: 'DELETE' }); rMenu(); } });
  el('prods-body').querySelectorAll('[data-stock]').forEach((b) => b.onclick = () => stockForm(b.dataset.stock));
}
function productForm(id) {
  const p = id ? state.prods.find((x) => x.id == id) : null;
  const m = modal(`
    <h3>${p ? esPE.menu.edit_product : esPE.menu.new_product}</h3>
    <div class="field"><label>Nombre</label><input class="input" id="pf-name" value="${esc(p?.name || '')}"></div>
    <div class="field"><label>Descripción</label><textarea class="input" id="pf-desc">${esc(p?.description || '')}</textarea></div>
    <div class="field"><label>Emoji</label><input class="input" id="pf-emoji" value="${esc(p?.emoji || '')}"></div>
    <div class="row"><div class="field" style="flex:1"><label>Precio (céntimos)</label><input class="input" id="pf-price" type="number" value="${p?.price_minor ?? 0}"></div>
    <div class="field" style="flex:1"><label>Promo (céntimos, opcional)</label><input class="input" id="pf-promo" type="number" value="${p?.promo_price_minor ?? ''}"></div></div>
    <div class="field"><label>Categoría</label><select class="input" id="pf-cat">${state.cats.map((c) => `<option value="${c.id}" ${p?.category_id == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="row"><label class="checkline" style="flex:1"><input type="checkbox" id="pf-stock" ${p?.track_stock ? 'checked' : ''}> ${esPE.menu.track_stock}</label>
    <div class="field" style="flex:1"><label>Stock</label><input class="input" id="pf-qty" type="number" value="${p?.stock_quantity ?? 0}"></div></div>
    <div class="row"><label class="checkline" style="flex:1"><input type="checkbox" id="pf-avail" ${p?.is_available ? 'checked' : ''}> ${esPE.menu.available}</label>
    <label class="checkline" style="flex:1"><input type="checkbox" id="pf-vis" ${p?.is_visible ? 'checked' : ''}> ${esPE.menu.visible}</label></div>
    <button class="btn btn-accent btn-lg btn-block" id="pf-save">${esPE.menu.save_product}</button>`, { title: '' });
  m.body.querySelector('#pf-save').onclick = async (e) => {
    const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true;
    const body = { name: el2(m, '#pf-name').value.trim(), description: el2(m, '#pf-desc').value.trim(), emoji: el2(m, '#pf-emoji').value.trim(), price_minor: Number(el2(m, '#pf-price').value), promo_price_minor: el2(m, '#pf-promo').value ? Number(el2(m, '#pf-promo').value) : null, category_id: Number(el2(m, '#pf-cat').value), track_stock: el2(m, '#pf-stock').checked ? 1 : 0, stock_quantity: Number(el2(m, '#pf-qty').value) || 0, is_available: el2(m, '#pf-avail').checked ? 1 : 0, is_visible: el2(m, '#pf-vis').checked ? 1 : 0 };
    try {
      if (p) await api(`/menu/products/${p.id}`, { method: 'PATCH', body });
      else await api('/menu/products', { method: 'POST', body });
      toast(esPE.menu.product_ok, 'ok'); m.close(); rMenu();
    } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; }
  };
}
function el2(m, sel) { return m.body.querySelector(sel); }
function catForm() {
  const m = modal(`<h3>Nueva categoría</h3><div class="field"><label>Nombre</label><input class="input" id="cf-name"></div><button class="btn btn-accent btn-lg btn-block" id="cf-save">Guardar categoría</button>`, { title: '' });
  m.body.querySelector('#cf-save').onclick = async (e) => { const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true; try { await api('/menu/categories', { method: 'POST', body: { name: el2(m, '#cf-name').value.trim() } }); toast('Categoría creada', 'ok'); m.close(); rMenu(); } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
}
function stockForm(pid) {
  const m = modal(`<h3>Ajustar stock</h3><div class="field"><label>Cambio (positivo o negativo)</label><input class="input" id="sf-delta" type="number" placeholder="Ej. -2"></div><button class="btn btn-accent btn-lg btn-block" id="sf-save">Aplicar</button>`, { title: '' });
  m.body.querySelector('#sf-save').onclick = async (e) => { const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true; try { await api(`/menu/products/${pid}/stock`, { method: 'POST', body: { change_qty: Number(el2(m, '#sf-delta').value) } }); toast('Stock actualizado', 'ok'); m.close(); rMenu(); } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
}

/* ---------- INVENTARIO ---------- */
async function rInventario() {
  main().innerHTML = `<div class="split"><h2>Inventario</h2><div class="row"><button class="btn btn-accent" id="inv-add">Nuevo ítem</button><button class="btn btn-ghost" id="inv-move">Registrar movimiento</button></div></div>
    <div id="inv-box" style="margin-top:16px">${skeletonRows(4)}</div>
    <h4 style="margin-top:28px">Movimientos</h4><div class="table-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Fecha</th><th>Ítem</th><th>Cambio</th><th>Motivo</th><th>Usuario</th></tr></thead><tbody id="mov-body"></tbody></table></div>`;
  const inv = await api('/inventory');
  el('inv-box').innerHTML = inv.items.length ? `<div class="grid grid-3">${inv.items.map((i) => `<div class="card metric"><div class="label">${esc(i.name)} <span class="muted">(${esc(i.unit)})</span></div><div class="value ${i.qty_on_hand <= i.reorder_level && i.reorder_level > 0 ? 'accent-value' : ''}">${i.qty_on_hand}</div><div class="delta">Mínimo sugerido: ${i.reorder_level}</div></div>`).join('')}</div>` : emptyState('📦', esPE.empty.inventory);
  const movs = await api('/inventory/movements');
  el('mov-body').innerHTML = movs.length ? movs.slice(0, 60).map((m) => `<tr><td>${fmtDate(m.created_at)}</td><td>${esc(m.item_name)}</td><td class="num ${m.change_qty > 0 ? '' : ''}" style="color:${m.change_qty > 0 ? 'var(--success)' : 'var(--danger)'}">${m.change_qty > 0 ? '+' : ''}${m.change_qty}</td><td>${esc(m.reason)}</td><td class="muted">${m.user_id ?? '—'}</td></tr>`).join('') : `<tr><td colspan="5">${emptyState('📊', esPE.empty.inventory)}</td></tr>`;
  el('inv-add').onclick = () => {
    const m = modal(`<h3>Nuevo ítem</h3><div class="field"><label>Nombre</label><input class="input" id="ia-name"></div><div class="field"><label>Unidad</label><input class="input" id="ia-unit" value="unidad"></div><div class="field"><label>Stock inicial</label><input class="input" id="ia-qty" type="number" value="0"></div><div class="field"><label>Nivel de reorden</label><input class="input" id="ia-reorder" type="number" value="0"></div><button class="btn btn-accent btn-lg btn-block" id="ia-save">Guardar</button>`, { title: '' });
    m.body.querySelector('#ia-save').onclick = async (e) => { const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true; try { await api('/inventory/items', { method: 'POST', body: { name: el2(m, '#ia-name').value.trim(), unit: el2(m, '#ia-unit').value.trim(), qty_on_hand: Number(el2(m, '#ia-qty').value), reorder_level: Number(el2(m, '#ia-reorder').value) } }); toast('Ítem creado', 'ok'); m.close(); rInventario(); } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
  };
  el('inv-move').onclick = async () => {
    const items = await api('/inventory');
    const m = modal(`<h3>Registrar movimiento</h3><div class="field"><label>Ítem</label><select class="input" id="im-item">${items.items.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Motivo</label><select class="input" id="im-reason"><option value="purchase">Compra</option><option value="usage">Uso/consumo</option><option value="adjustment">Ajuste</option></select></div>
    <div class="field"><label>Cambio (positivo o negativo)</label><input class="input" id="im-delta" type="number" placeholder="Ej. 5 o -3"></div>
    <button class="btn btn-accent btn-lg btn-block" id="im-save">Guardar movimiento</button>`, { title: '' });
    m.body.querySelector('#im-save').onclick = async (e) => { const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true; try { await api('/inventory/movements', { method: 'POST', body: { item_id: Number(el2(m, '#im-item').value), reason: el2(m, '#im-reason').value, change_qty: Number(el2(m, '#im-delta').value) } }); toast('Movimiento registrado', 'ok'); m.close(); rInventario(); } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
  };
}

/* ---------- CLIENTES ---------- */
async function rClientes() {
  main().innerHTML = `<div class="split"><h2>Clientes</h2><input class="input" style="width:auto;min-width:200px" id="c-q" placeholder="Buscar…"></div>
    <div class="table-wrap" style="margin-top:16px"><table class="tbl"><thead><tr><th>Cliente</th><th>Teléfono</th><th>Pedidos</th><th>Total</th><th>Ticket avg</th><th>Último pedido</th><th></th></tr></thead><tbody id="c-body"></tbody></table></div>`;
  const load = async () => {
    const q = el('c-q').value;
    const rows = await api('/customers' + (q ? '?q=' + encodeURIComponent(q) : ''));
    el('c-body').innerHTML = rows.length ? rows.map((c) => `<tr><td><strong>${esc(c.name)}</strong>${c.email ? `<div class="muted" style="font-size:12px">${esc(c.email)}</div>` : ''}</td>
      <td class="num">${esc(c.normalized_phone)}</td><td class="num">${c.orders_count}</td><td class="num">${fmtMoney(c.total_spent_minor)}</td><td class="num">${fmtMoney(c.average_ticket_minor)}</td>
      <td class="muted">${c.last_order_at ? fmtDate(c.last_order_at) : '—'}</td><td><button class="btn btn-ghost btn-sm" data-c="${c.id}">360°</button></td></tr>`).join('')
      : `<tr><td colspan="7">${emptyState('👥', esPE.empty.customers)}</td></tr>`;
    el('c-body').querySelectorAll('[data-c]').forEach((b) => b.onclick = () => customer360(b.dataset.c));
  };
  el('c-q').oninput = load;
  await load();
}
async function customer360(id) {
  const c = await api(`/customers/${id}`);
  const m = modal(`
    <h3>${esc(c.name)}</h3>
    <div class="grid grid-3" style="margin:12px 0">${metric('Pedidos', c.orders_count)}${metric('Total', fmtMoney(c.total_spent_minor))}${metric('Ticket', fmtMoney(c.average_ticket_minor))}</div>
    <h4>Pedidos</h4>${c.orders.length ? `<div class="stack">${c.orders.map((o) => `<div class="split" style="font-size:13px"><span>#${o.id} ${statusBadge(o.status)}</span><span class="num">${fmtMoney(o.total_minor)} · ${fmtDate(o.placed_at)}</span></div>`).join('')}</div>` : '<p class="muted">Sin pedidos.</p>'}
    <h4 style="margin-top:16px">Reseñas</h4>${c.reviews.length ? c.reviews.map((r) => `<p class="muted" style="font-size:13px">${'★'.repeat(r.rating || 0)}${'☆'.repeat(5 - (r.rating || 0))} — ${esc(r.comment || 'sin comentario')}</p>`).join('') : '<p class="muted">Sin reseñas.</p>'}
    <h4 style="margin-top:16px">Notas internas</h4><div class="stack">${c.notes.map((n) => `<p class="muted" style="font-size:13px;margin:0">${esc(n.note)} <span class="muted">— ${esc(n.author || '')}</span></p>`).join('') || '<p class="muted">Sin notas.</p>'}</div>
    <div class="row" style="margin-top:12px"><input class="input" id="n-text" placeholder="Nueva nota interna…" style="flex:1"><button class="btn" id="n-add">Agregar</button></div>`, { title: '' });
  m.body.querySelector('#n-add').onclick = async (e) => { const btn = e.currentTarget; const txt = el2(m, '#n-text').value.trim(); if (!txt) return; btn.classList.add('loading'); btn.disabled = true; try { await api(`/customers/${id}/notes`, { method: 'POST', body: { note: txt } }); toast('Nota guardada', 'ok'); m.close(); customer360(id); } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
}

/* ---------- RESERVAS ---------- */
async function rReservas() {
  main().innerHTML = `<div class="split"><h2>Reservas</h2><div class="row"><button class="btn btn-ghost" id="rs-settings">Configuración</button></div></div>
    <div class="topbar"><select class="input" style="width:auto" id="rs-status"><option value="">Todas</option><option value="pending">Pendientes</option><option value="confirmed">Confirmadas</option></select></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Cliente</th><th>Personas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="rs-body"></tbody></table></div>`;
  const load = async () => {
    const q = el('rs-status').value ? '?status=' + el('rs-status').value : '';
    const rows = await api('/reservations' + q);
    el('rs-body').innerHTML = rows.length ? rows.map((r) => `<tr><td>${fmtDate(r.datetime)}</td><td><strong>${esc(r.name)}</strong><div class="muted" style="font-size:12px">${esc(r.phone)}</div></td>
      <td>${r.party_size}</td><td>${statusBadge(r.status)}</td>
      <td><div class="actions">${['confirmed', 'attended', 'no_show', 'cancelled'].filter((s) => s !== r.status).map((s) => `<button class="btn btn-ghost btn-sm" data-rs="${r.id}" data-s="${s}">${({ confirmed: 'Confirmar', attended: 'Asistió', no_show: 'No asistió', cancelled: 'Cancelar' })[s]}</button>`).join('')}</div></td></tr>`).join('')
      : `<tr><td colspan="5">${emptyState('📅', esPE.empty.reservations)}</td></tr>`;
    el('rs-body').querySelectorAll('[data-rs]').forEach((b) => b.onclick = async () => { try { await api(`/reservations/${b.dataset.rs}/transition`, { method: 'POST', body: { status: b.dataset.s } }); toast('Reserva actualizada', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } });
  };
  el('rs-status').onchange = load;
  el('rs-settings').onclick = async () => {
    const s = await api('/reservation-settings');
    const m = modal(`<h3>Configuración de reservas</h3>
      <div class="row"><div class="field" style="flex:1"><label>Apertura</label><input class="input" id="r-open" value="${esc(s.opening_time || '12:00')}"></div><div class="field" style="flex:1"><label>Cierre</label><input class="input" id="r-close" value="${esc(s.closing_time || '22:00')}"></div></div>
      <div class="row"><div class="field" style="flex:1"><label>Máx. personas</label><input class="input" id="r-max" type="number" value="${s.max_party_size || 8}"></div><div class="field" style="flex:1"><label>Antelación mín. (min)</label><input class="input" id="r-mina" type="number" value="${s.min_advance_minutes || 60}"></div></div>
      <div class="field"><label>Antelación máx. (días)</label><input class="input" id="r-maxa" type="number" value="${s.max_advance_days || 30}"></div>
      <button class="btn btn-accent btn-lg btn-block" id="rs-save">Guardar</button>`, { title: '' });
    m.body.querySelector('#rs-save').onclick = async (e) => { const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true; try { await api('/reservation-settings', { method: 'PATCH', body: { opening_time: el2(m, '#r-open').value, closing_time: el2(m, '#r-close').value, max_party_size: Number(el2(m, '#r-max').value), min_advance_minutes: Number(el2(m, '#r-mina').value), max_advance_days: Number(el2(m, '#r-maxa').value) } }); toast('Guardado', 'ok'); m.close(); } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
  };
  await load();
}

/* ---------- RESEÑAS ---------- */
async function rReseñas() {
  main().innerHTML = skeletonRows(5);
  const d = await api('/reviews');
  main().innerHTML = `<div class="split"><h2>Reseñas</h2><button class="btn btn-accent" id="rv-point">Crear punto de reseña</button></div>
    <div class="grid grid-3" style="margin:20px 0">
      ${metric('Feedback recibido', d.stats.total_feedback)}${metric('Calificación media', d.stats.avg_rating || '—')}${metric('Aperturas de puntos', d.stats.points_opened)}
    </div>
    <div class="card"><h4>Puntos de reseña</h4><div class="stack">${d.points.length ? d.points.map((p) => `<div class="split"><div><strong>${esc(p.name)}</strong> <span class="badge">${esc(p.type)}</span> ${p.is_active ? '' : '<span class="badge err">Inactivo</span>'}</div>
      <div class="row"><a class="btn btn-ghost btn-sm" href="/r/${p.token}" target="_blank">${esPE.reviews.copy_link}</a><span class="muted num">${p.opened_count} aperturas</span></div></div>`).join('') : '<p class="muted">Crea tu primer punto de reseña para el mostrador o mesas.</p>'}</div></div>
    <div class="card" style="margin-top:16px"><h4>Enlace de Google</h4><p class="muted">Pega la URL directa de tu reseña de Google para generar enlaces rastreables.</p>
      <div class="row"><input class="input" id="gurl" style="flex:1" value="${esc(d.google_connection?.review_url || '')}"><button class="btn" id="gsave">Guardar</button></div></div>
    <div class="card" style="margin-top:16px"><h4>Solicitudes</h4><div class="stack">${d.requests.length ? d.requests.slice(0, 20).map((r) => `<div class="split" style="font-size:13px"><span>#${r.order_number} · ${esc(r.customer_name)} <span class="muted">(${r.method === 'automatic' ? 'automática' : 'manual'})</span></span>${statusBadge(r.status)}</div>`).join('') : '<p class="muted">Las solicitudes de reseña aparecerán aquí.</p>'}</div></div>
    <div class="card" style="margin-top:16px"><h4>Comentarios privados</h4><div class="stack">${d.feedback.length ? d.feedback.slice(0, 20).map((f) => `<div class="split" style="font-size:13px"><span>${'★'.repeat(f.rating || 0) || '—'} <span class="muted">${esc(f.customer_name || '')}</span></span><span class="muted">${fmtDate(f.created_at)}</span></div><p class="muted" style="margin:0;font-size:13px">${esc(f.comment || '—')}</p>`).join('') : '<p class="muted">Los comentarios privados aparecerán aquí.</p>'}</div></div>`;
  el('rv-point').onclick = () => {
    const m = modal(`<h3>${esPE.reviews.new_point}</h3><div class="field"><label>Nombre</label><input class="input" id="rp-name" placeholder="Ej. Caja principal, Mesa 01"></div>
    <div class="field"><label>Tipo</label><select class="input" id="rp-type"><option value="counter">Mostrador</option><option value="table">Mesa</option><option value="delivery">Delivery</option><option value="packaging">Empaque</option></select></div>
    <button class="btn btn-accent btn-lg btn-block" id="rp-save">Crear</button>`, { title: '' });
    m.body.querySelector('#rp-save').onclick = async (e) => { const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true; try { const r = await api('/reviews/points', { method: 'POST', body: { name: el2(m, '#rp-name').value.trim(), type: el2(m, '#rp-type').value } }); toast('Punto creado', 'ok'); m.close(); rReseñas(); } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
  };
  el('gsave').onclick = async (e) => { const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true; try { await api('/reviews/google-link', { method: 'POST', body: { review_url: el('gurl').value.trim() } }); toast('Enlace guardado', 'ok'); btn.classList.remove('loading'); btn.disabled = false; } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
}

/* ---------- ANALÍTICA ---------- */
async function rAnalitica() {
  main().innerHTML = `<div class="split"><h2>Analítica</h2><div class="row"><input class="input" type="date" id="an-from" style="width:auto"><span class="muted">→</span><input class="input" type="date" id="an-to" style="width:auto"><button class="btn btn-ghost" id="an-csv">Exportar CSV</button></div></div><div id="an-body">${skeletonRows(5)}</div>`;
  const load = async () => {
    const from = el('an-from').value ? new Date(el('an-from').value + 'T00:00:00').toISOString() : '';
    const to = el('an-to').value ? new Date(el('an-to').value + 'T23:59:59').toISOString() : '';
    const qs = new URLSearchParams(); if (from) qs.set('from', from); if (to) qs.set('to', to);
    const a = await api('/analytics/summary?' + qs);
    el('an-body').innerHTML = `
      <div class="grid grid-3" style="margin:20px 0">${metric('Ingresos', fmtMoney(a.completed.revenue))}${metric('Pedidos entregados', a.completed.orders)}${metric('Ticket promedio', fmtMoney(a.completed.avg_ticket_minor))}</div>
      <div class="grid grid-2">
        <div class="card"><h4>Ventas por día</h4><div class="stack">${a.by_day.map((d) => `<div class="split" style="font-size:13px"><span>${esc(d.day)} <span class="muted">(${d.orders} pedidos)</span></span><span class="num">${fmtMoney(d.revenue)}</span></div>`).join('') || '<p class="muted">Sin datos en el rango.</p>'}</div></div>
        <div class="card"><h4>Productos más vendidos</h4><div class="stack">${a.top_products.map((p, i) => `<div class="split" style="font-size:13px"><span>${i + 1}. ${esc(p.name)} <span class="muted">×${p.qty}</span></span><span class="num">${fmtMoney(p.revenue)}</span></div>`).join('') || '<p class="muted">Sin ventas en el rango.</p>'}</div></div>
      </div>
      <div class="card" style="margin-top:16px"><h4>Pagos y reembolsos</h4><div class="stack">${a.by_payment.map((p) => `<div class="split" style="font-size:13px"><span>${statusLabel(paymentText(p.payment_status))}</span><span class="num">${p.n} pedidos · ${fmtMoney(p.s || 0)}</span></div>`).join('') || '<p class="muted">Sin pagos en el rango.</p>'}</div><p class="muted" style="font-size:13px">Reembolsos: ${fmtMoney(a.refunds.s)} (${a.refunds.n} casos)</p></div>`;
  };
  el('an-csv').onclick = async () => {
    const a = await api('/analytics/summary');
    const rows = [['fecha', 'pedidos', 'ingresos_minor'], ...a.by_day.map((d) => [d.day, d.orders, d.revenue])];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const b = new Blob([csv], { type: 'text/csv' }); const aEl = document.createElement('a'); aEl.href = URL.createObjectURL(b); aEl.download = 'analitica.csv'; aEl.click();
  };
  el('an-from').onchange = el('an-to').onchange = load;
  await load();
}
function paymentText(s) { return ({ unpaid: 'Pendiente de pago', pending: 'Pago en proceso', paid: 'Pagado', failed: 'Pago fallido', refunded: 'Reembolsado', partially_refunded: 'Reembolso parcial' })[s] || s; }

/* ---------- PROMOCIONES / CUPONES ---------- */
async function rPromos() {
  main().innerHTML = `<div class="split"><h2>Promociones</h2><button class="btn btn-accent" id="pr-add">Nueva promoción</button></div>
    <div class="table-wrap" style="margin-top:16px"><table class="tbl"><thead><tr><th>Nombre</th><th>Tipo</th><th>Vigencia</th><th>Estado</th><th></th></tr></thead><tbody id="pr-body"></tbody></table></div>`;
  const rows = await api('/promotions');
  const typeTxt = { special_price: 'Precio especial', percentage_discount: 'Descuento %', buy_x_get_y: 'Lleva X paga Y', bundle: 'Combo', free_item: 'Producto gratis' };
  el('pr-body').innerHTML = rows.length ? rows.map((p) => `<tr><td><strong>${esc(p.name)}</strong></td><td>${typeTxt[p.promotion_type] || p.promotion_type}</td><td class="muted">${p.starts_at ? fmtDate(p.starts_at) : 'inmediata'}${p.ends_at ? ' → ' + fmtDate(p.ends_at) : ''}</td><td>${p.is_active ? '<span class="badge ok">Activa</span>' : '<span class="badge err">Inactiva</span>'}</td><td><button class="btn btn-ghost btn-sm" data-tg="${p.id}">${p.is_active ? 'Pausar' : 'Activar'}</button></td></tr>`).join('') : `<tr><td colspan="5">${emptyState('🏷️', esPE.empty.promotions)}</td></tr>`;
  el('pr-body').querySelectorAll('[data-tg]').forEach((b) => b.onclick = async () => { const p = rows.find((x) => x.id == b.dataset.tg); await api(`/promotions/${p.id}`, { method: 'PATCH', body: { is_active: p.is_active ? 0 : 1 } }); rPromos(); });
  el('pr-add').onclick = () => {
    const m = modal(`<h3>Nueva promoción</h3><div class="field"><label>Nombre</label><input class="input" id="pro-name"></div>
    <div class="field"><label>Tipo</label><select class="input" id="pro-type"><option value="special_price">Precio especial (usa el precio promocional del producto)</option><option value="percentage_discount">Descuento por porcentaje</option><option value="buy_x_get_y">Lleva X, paga Y (mismo producto)</option></select></div>
    <div class="field"><label>Producto (opcional para %)</label><select class="input" id="pro-prod"><option value="">Todos</option>${state.prods?.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
    <div class="row"><div class="field" style="flex:1"><label>% descuento (bps)</label><input class="input" id="pro-pct" type="number" placeholder="1000 = 10%"></div></div>
    <div class="row"><div class="field" style="flex:1"><label>Lleva (X)</label><input class="input" id="pro-x" type="number"></div><div class="field" style="flex:1"><label>Paga (Y)</label><input class="input" id="pro-y" type="number"></div></div>
    <button class="btn btn-accent btn-lg btn-block" id="pro-save">Crear</button>`, { title: '' });
    m.body.querySelector('#pro-save').onclick = async (e) => { const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true;
      const type = el2(m, '#pro-type').value;
      try { await api('/promotions', { method: 'POST', body: { name: el2(m, '#pro-name').value.trim(), promotion_type: type, product_id: el2(m, '#pro-prod').value ? Number(el2(m, '#pro-prod').value) : null, percent_off_bps: el2(m, '#pro-pct').value ? Number(el2(m, '#pro-pct').value) : null, buy_x: el2(m, '#pro-x').value ? Number(el2(m, '#pro-x').value) : null, get_y: el2(m, '#pro-y').value ? Number(el2(m, '#pro-y').value) : null } }); toast('Promoción creada', 'ok'); m.close(); rPromos(); } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
  };
}
async function rCupones() {
  main().innerHTML = `<div class="split"><h2>Cupones</h2><button class="btn btn-accent" id="cp-add">Nuevo cupón</button></div>
    <div class="table-wrap" style="margin-top:16px"><table class="tbl"><thead><tr><th>Código</th><th>Tipo</th><th>Valor</th><th>Mínimo</th><th>Usos</th><th>Estado</th></tr></thead><tbody id="cp-body"></tbody></table></div>`;
  const rows = await api('/coupons');
  el('cp-body').innerHTML = rows.length ? rows.map((c) => `<tr><td><strong>${esc(c.code)}</strong></td><td>${c.discount_type === 'percent' ? '%' : 'Fijo'}</td><td class="num">${c.discount_type === 'percent' ? c.discount_value + '%' : fmtMoney(c.discount_value)}</td><td class="num">${fmtMoney(c.minimum_order_minor)}</td><td class="num">${c.used_count}${c.total_usage_limit ? '/' + c.total_usage_limit : ''}</td><td>${c.is_active ? '<span class="badge ok">Activo</span>' : '<span class="badge err">Inactivo</span>'}</td></tr>`).join('') : `<tr><td colspan="6">${emptyState('🎟️', esPE.empty.coupons)}</td></tr>`;
  el('cp-add').onclick = () => {
    const m = modal(`<h3>Nuevo cupón</h3><div class="field"><label>Código</label><input class="input" id="cu-code" placeholder="BIENVENIDA10"></div>
    <div class="row"><div class="field" style="flex:1"><label>Tipo</label><select class="input" id="cu-type"><option value="percent">% descuento</option><option value="fixed">Monto fijo</option></select></div><div class="field" style="flex:1"><label>Valor</label><input class="input" id="cu-val" type="number"></div></div>
    <div class="row"><div class="field" style="flex:1"><label>Mínimo (céntimos)</label><input class="input" id="cu-min" type="number" value="0"></div><div class="field" style="flex:1"><label>Máx. descuento (céntimos)</label><input class="input" id="cu-maxd" type="number"></div></div>
    <div class="row"><div class="field" style="flex:1"><label>Límite usos total</label><input class="input" id="cu-tot" type="number"></div><div class="field" style="flex:1"><label>Límite por cliente</label><input class="input" id="cu-cust" type="number"></div></div>
    <button class="btn btn-accent btn-lg btn-block" id="cu-save">Crear cupón</button>`, { title: '' });
    m.body.querySelector('#cu-save').onclick = async (e) => { const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true;
      try { await api('/coupons', { method: 'POST', body: { code: el2(m, '#cu-code').value.trim(), discount_type: el2(m, '#cu-type').value, discount_value: Number(el2(m, '#cu-val').value), minimum_order_minor: Number(el2(m, '#cu-min').value), maximum_discount_minor: el2(m, '#cu-maxd').value ? Number(el2(m, '#cu-maxd').value) : null, total_usage_limit: el2(m, '#cu-tot').value ? Number(el2(m, '#cu-tot').value) : null, customer_usage_limit: el2(m, '#cu-cust').value ? Number(el2(m, '#cu-cust').value) : null } }); toast('Cupón creado', 'ok'); m.close(); rCupones(); } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
  };
}

/* ---------- FACTURACIÓN ---------- */
async function rBilling() {
  main().innerHTML = skeletonRows(4);
  const b = await api('/billing');
  const feats = Object.entries(b.features).filter(([k]) => !['plan'].includes(k)).map(([k, v]) => [k.replace(/\./g, ' '), v]);
  main().innerHTML = `<div class="split"><h2>Facturación</h2></div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h4>Plan actual</h4><p style="font-size:30px;font-family:var(--font-display);margin:6px 0">${b.subscription ? capitalize(b.subscription.plan_name) : 'Starter'}</p>
        <div class="row">${statusBadge(b.subscription?.status || 'active')}${b.subscription?.trial_ends_at ? `<span class="badge accent">Prueba hasta ${fmtDate(b.subscription.trial_ends_at)}</span>` : ''}</div>
        ${b.subscription?.cancel_at_period_end ? '<p class="muted">Se cancelará al final del período.</p>' : ''}
        <div class="row" style="margin-top:14px">${b.subscription?.plan_id !== 'pro' ? `<button class="btn" data-plan="pro">Cambiar a Pro</button>` : ''}${b.subscription?.plan_id !== 'plus' ? `<button class="btn btn-ghost" data-plan="plus">Cambiar a Plus</button>` : ''}
        ${b.subscription?.cancel_at_period_end ? `<button class="btn btn-ghost" data-retry="1">Reactivar</button>` : `<button class="btn btn-danger" data-cancel="1">Cancelar suscripción</button>`}</div></div>
      <div class="card"><h4>Ventajas incluidas</h4><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px">${feats.map(([k, v]) => `<span class="badge">${esc(k)}: <strong>${v === -1 ? '∞' : v}</strong></span>`).join('')}</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h4>Facturas</h4><div class="table-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Monto</th><th>Estado</th></tr></thead><tbody>${b.invoices.length ? b.invoices.map((i) => `<tr><td>${fmtDate(i.created_at)}</td><td class="num">${fmtMoney(i.amount_minor)}</td><td>${statusBadge(i.status)}</td></tr>`).join('') : '<tr><td colspan="3">Sin facturas aún.</td></tr>'}</tbody></table></div></div>
    <div class="card" style="margin-top:16px"><h4>Planes</h4><div class="grid grid-3">${b.plans.map((p) => `<div class="card card-tight"><h4>${esc(p.name)}</h4><p style="font-size:26px;font-family:var(--font-display);margin:4px 0">${fmtMoney(p.price_minor_monthly)}<span class="muted" style="font-size:13px">/mes</span></p><p class="muted" style="font-size:12px">${p.id === 'pro' ? 'Operación completa, comandas y reservas' : p.id === 'plus' ? 'Venta directa y reputación' : 'Presencia digital'}</p></div>`).join('')}</div></div>`;
  main().querySelectorAll('[data-plan]').forEach((x) => x.onclick = async () => { try { await api('/billing/checkout', { method: 'POST', body: { plan_id: x.dataset.plan } }); toast('Plan actualizado', 'ok'); rBilling(); } catch (e) { toast(e.message, 'err'); } });
  main().querySelector('[data-cancel]')?.addEventListener('click', async () => { if (!confirm('¿Cancelar la suscripción? Se mantendrá activa hasta fin de período.')) return; await api('/billing/cancel', { method: 'POST' }); toast('Cancelación programada', 'ok'); rBilling(); });
  main().querySelector('[data-retry]')?.addEventListener('click', async () => { await api('/billing/retry', { method: 'POST' }); toast('Suscripción reactivada', 'ok'); rBilling(); });
}
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/* ---------- EQUIPO ---------- */
async function rEquipo() {
  main().innerHTML = `<div class="split"><h2>Equipo</h2><button class="btn btn-accent" id="tm-add">Invitar miembro</button></div>
    <div class="table-wrap" style="margin-top:16px"><table class="tbl"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Último acceso</th><th>Estado</th><th></th></tr></thead><tbody id="tm-body"></tbody></table></div>`;
  const rows = await api('/team');
  el('tm-body').innerHTML = rows.map((u) => `<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td>${labelRole(u.role)}</td><td class="muted">${u.last_login_at ? fmtDate(u.last_login_at) : '—'}</td><td>${u.active ? '<span class="badge ok">Activo</span>' : '<span class="badge err">Inactivo</span>'}</td>
    <td><div class="actions"><select class="input" style="width:auto;min-height:34px" data-role="${u.id}">${['manager', 'kitchen', 'cashier', 'marketing', 'viewer'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${labelRole(r)}</option>`).join('')}</select>
    <button class="btn btn-ghost btn-sm" data-tg="${u.id}">${u.active ? 'Pausar' : 'Activar'}</button></div></td></tr>`).join('');
  el('tm-body').querySelectorAll('[data-role]').forEach((s) => s.onchange = async () => { await api(`/team/${s.dataset.role}`, { method: 'PATCH', body: { role: s.value } }); toast('Rol actualizado', 'ok'); });
  el('tm-body').querySelectorAll('[data-tg]').forEach((b) => b.onclick = async () => { const u = rows.find((x) => x.id == b.dataset.tg); await api(`/team/${u.id}`, { method: 'PATCH', body: { active: u.active ? 0 : 1 } }); rEquipo(); });
  el('tm-add').onclick = () => {
    const m = modal(`<h3>Invitar miembro</h3><div class="field"><label>Nombre</label><input class="input" id="ti-name"></div><div class="field"><label>Correo</label><input class="input" id="ti-email" type="email"></div>
    <div class="field"><label>Rol</label><select class="input" id="ti-role"><option value="manager">Gerente</option><option value="kitchen">Cocina</option><option value="cashier">Caja</option><option value="marketing">Marketing</option><option value="viewer">Solo lectura</option></select></div>
    <button class="btn btn-accent btn-lg btn-block" id="ti-save">Invitar</button><p class="help" style="margin-top:10px">Se generará una contraseña temporal que podrás compartir de forma segura.</p>`, { title: '' });
    m.body.querySelector('#ti-save').onclick = async (e) => { const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true; try { const r = await api('/team', { method: 'POST', body: { name: el2(m, '#ti-name').value.trim(), email: el2(m, '#ti-email').value.trim(), role: el2(m, '#ti-role').value } }); toast(`Creado: ${r.email} · contraseña temporal: ${r.temp_password}`, 'ok'); m.close(); rEquipo(); } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
  };
}

/* ---------- AUDITORÍA ---------- */
async function rAuditoria() {
  main().innerHTML = `<div class="split"><h2>Auditoría</h2><select class="input" style="width:auto" id="au-type"><option value="">Todas las entidades</option><option value="order">Pedidos</option><option value="menu_product">Productos</option><option value="payment">Pagos</option><option value="customer">Clientes</option><option value="subscription">Suscripción</option></select></div>
    <div class="table-wrap" style="margin-top:16px"><table class="tbl"><thead><tr><th>Fecha</th><th>Acción</th><th>Entidad</th><th>Actor</th><th>Detalle</th></tr></thead><tbody id="au-body"></tbody></table></div>`;
  const load = async () => {
    const q = el('au-type').value ? '?entity_type=' + el('au-type').value : '';
    const rows = await api('/audit' + q);
    el('au-body').innerHTML = rows.slice(0, 150).map((r) => `<tr><td class="muted">${fmtDate(r.created_at)}</td><td><code style="font-size:12px">${esc(r.action)}</code></td><td>${esc(r.entity_type || '')} ${r.entity_id ? '#' + esc(r.entity_id) : ''}</td><td>${esc(r.user_email || 'sistema')}</td><td class="muted" style="font-size:12px;max-width:300px;word-break:break-word">${r.after_json ? esc(r.after_json).slice(0, 90) : ''}</td></tr>`).join('') || '<tr><td colspan="5">Sin registros.</td></tr>';
  };
  el('au-type').onchange = load;
  await load();
}

/* ---------- CONFIGURACIÓN ---------- */
async function rConfig() {
  const v = await api('/venue');
  state.venue = v;
  const zoneRows = v.zones || [];
  main().innerHTML = `<div class="split"><h2>Configuración</h2></div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h4>Datos del negocio</h4>
        <div class="field"><label>Nombre</label><input class="input" id="cf-name" value="${esc(v.name)}"></div>
        <div class="field"><label>Teléfono / WhatsApp</label><input class="input" id="cf-wa" value="${esc(v.whatsapp || '')}"></div>
        <div class="row"><div class="field" style="flex:1"><label>Dirección</label><input class="input" id="cf-addr" value="${esc(v.address || '')}"></div><div class="field" style="flex:1"><label>Distrito</label><input class="input" id="cf-dist" value="${esc(v.district || '')}"></div></div>
        <div class="row"><div class="field" style="flex:1"><label>Instagram</label><input class="input" id="cf-ig" value="${esc(v.instagram || '')}"></div><div class="field" style="flex:1"><label>Emoji logo</label><input class="input" id="cf-logo" value="${esc(v.logo_emoji || '')}"></div></div>
        <div class="field"><label>Horarios (JSON por día 1=Lun…7=Dom)</label><textarea class="input" id="cf-hours">${esc(JSON.stringify(v.opening_hours || null))}</textarea></div>
        <button class="btn btn-accent" id="cf-save">Guardar negocio</button></div>
      <div class="card"><h4>Entrega y cobros</h4>
        <label class="checkline" style="margin-bottom:8px"><input type="checkbox" id="cf-pick" ${v.pickup_enabled ? 'checked' : ''}> Recojo habilitado</label>
        <label class="checkline" style="margin-bottom:8px"><input type="checkbox" id="cf-deliv" ${v.delivery_enabled ? 'checked' : ''}> Delivery habilitado</label>
        <div class="field"><label>Cuota fija de delivery (céntimos)</label><input class="input" id="cf-fee" type="number" value="${v.flat_delivery_fee_minor || 0}"></div>
        <div class="field"><label>IGV (bps)</label><input class="input" id="cf-tax" type="number" value="${v.tax_rate_bps || 1800}"></div>
        <button class="btn btn-accent" id="cf-save2">Guardar entrega</button>
        <h4 style="margin-top:20px">Zonas de delivery</h4><div class="stack" id="cf-zones">${(zoneRows || []).map((z) => `<div class="split" style="font-size:13px"><span>${esc(z.name)}</span><span class="muted">${fmtMoney(z.delivery_fee_minor)} · mín ${fmtMoney(z.minimum_order_minor)}</span></div>`).join('') || '<p class="muted">Sin zonas.</p>'}</div>
      </div></div>`;
  el('cf-save').onclick = async (e) => { const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true;
    let hoursJson = el('cf-hours').value.trim(); try { JSON.parse(hoursJson); } catch { toast('Horarios: JSON inválido', 'err'); btn.classList.remove('loading'); btn.disabled = false; return; }
    try { await api('/venue', { method: 'PATCH', body: { name: el('cf-name').value.trim(), whatsapp: el('cf-wa').value.trim(), address: el('cf-addr').value.trim(), district: el('cf-dist').value.trim(), instagram: el('cf-ig').value.trim(), logo_emoji: el('cf-logo').value.trim(), opening_hours_json: hoursJson === 'null' ? null : hoursJson } }); toast('Negocio guardado', 'ok'); btn.classList.remove('loading'); btn.disabled = false; } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
  el('cf-save2').onclick = async (e) => { const btn = e.currentTarget; btn.classList.add('loading'); btn.disabled = true;
    try { await api('/venue', { method: 'PATCH', body: { pickup_enabled: el('cf-pick').checked ? 1 : 0, delivery_enabled: el('cf-deliv').checked ? 1 : 0, flat_delivery_fee_minor: Number(el('cf-fee').value), tax_rate_bps: Number(el('cf-tax').value) } }); toast('Configuración guardada', 'ok'); btn.classList.remove('loading'); btn.disabled = false; } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
}

/* ---------- LOGIN ---------- */
function renderLogin() {
  $('#view').innerHTML = `<div class="section"><div class="shell" style="max-width:440px"><main id="main">
    <div style="text-align:center;margin-bottom:28px"><span style="font-size:40px" aria-hidden="true">🍽️</span><div class="page-kicker" style="margin-top:12px">Tu estación de servicio</div><h1 style="margin:6px 0 4px">Restaurant OS</h1><p class="muted">Ventas, cocina y clientes en un mismo ritmo.</p></div>
    <div class="card">
      <div class="row" role="tablist" aria-label="Acceso" style="margin-bottom:18px"><button class="btn btn-sm ${state._reg ? 'btn-ghost' : ''}" id="tab-login" role="tab" aria-selected="${!state._reg}">Iniciar sesión</button><button class="btn btn-sm ${state._reg ? '' : 'btn-ghost'}" id="tab-reg" role="tab" aria-selected="${state._reg}">Crear cuenta</button></div>
      <div id="authform"></div>
    </div>
    <p class="help" style="text-align:center;margin-top:18px">Usa las credenciales entregadas por tu administrador.</p>
  </main></div></div>`;
  el('tab-login').onclick = () => { state._reg = false; authForm(); };
  el('tab-reg').onclick = () => { state._reg = true; authForm(); };
  state._reg = false; authForm();
  enhanceFormControls();
}
function authForm() {
  el('tab-login').classList.toggle('btn-ghost', state._reg);
  el('tab-reg').classList.toggle('btn-ghost', !state._reg);
  el('tab-login').setAttribute('aria-selected', String(!state._reg));
  el('tab-reg').setAttribute('aria-selected', String(state._reg));
  if (state._reg) {
    el('authform').innerHTML = `<form id="auth-form"><div class="field"><label for="a-name">Tu nombre</label><input class="input" id="a-name" name="name" autocomplete="name" required></div>
      <div class="field"><label for="a-email">Correo</label><input class="input" id="a-email" name="email" type="email" autocomplete="email" spellcheck="false" required></div>
      <div class="field"><label for="a-pass">Contraseña (mín. 8)</label><input class="input" id="a-pass" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="field"><label for="a-biz">Nombre del negocio</label><input class="input" id="a-biz" name="business_name" autocomplete="organization" placeholder="Ej. Casa Aurora…" required></div>
      <button class="btn btn-accent btn-lg btn-block" id="a-go" type="submit">Crear cuenta y activar</button></form>`;
    el('auth-form').onsubmit = async (e) => { e.preventDefault(); const btn = el('a-go'); btn.classList.add('loading'); btn.disabled = true;
      try { await api('/auth/register', { method: 'POST', body: { name: el('a-name').value.trim(), email: el('a-email').value.trim(), password: el('a-pass').value, business_name: el('a-biz').value.trim(), slug: slugify(el('a-biz').value) } }); toast('Cuenta creada. Completa la configuración de tu local.', 'ok'); boot(); } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
  } else {
    el('authform').innerHTML = `<form id="auth-form"><div class="field"><label for="a-email">Correo</label><input class="input" id="a-email" name="email" type="email" autocomplete="email" spellcheck="false" required autofocus></div>
      <div class="field"><label for="a-pass">Contraseña</label><input class="input" id="a-pass" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn btn-accent btn-lg btn-block" id="a-go" type="submit">Iniciar sesión</button></form>`;
    el('auth-form').onsubmit = async (e) => { e.preventDefault(); const btn = el('a-go'); btn.classList.add('loading'); btn.disabled = true;
      try { await api('/auth/login', { method: 'POST', body: { email: el('a-email').value.trim(), password: el('a-pass').value } }); toast('Sesión iniciada', 'ok'); boot(); } catch (err) { toast(err.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; } };
  }
}
function slugify(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }

boot();
