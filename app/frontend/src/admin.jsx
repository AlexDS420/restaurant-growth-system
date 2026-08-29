import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const money = (minor = 0) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(minor / 100);
const config = window.__ROS_CONFIG__ || {};
const directEnabled = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(String(config.supabaseUrl || '')) && String(config.supabaseAnonKey || '').length > 20 && !String(config.supabaseAnonKey).startsWith('TU_');
const tokenKey = 'ros_admin_access_token';
async function api(path, options = {}) {
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'No se pudo completar la operación.');
  return body.data;
}

async function directAuth(email, password) {
  if (!directEnabled) throw new Error('BFF_UNAVAILABLE');
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.supabaseAnonKey }, body: JSON.stringify({ email, password }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error('Correo o contraseña incorrectos.');
  localStorage.setItem(tokenKey, body.access_token); return body;
}
async function directApi(path, options = {}) {
  const token = localStorage.getItem(tokenKey); if (!token) throw new Error('Inicia sesión para continuar.');
  const response = await fetch(`${config.supabaseUrl}/rest/v1${path}`, { ...options, headers: { Accept: 'application/json', apikey: config.supabaseAnonKey, Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || 'No se pudo consultar Supabase.'); return body;
}
async function directProfile() {
  const token = localStorage.getItem(tokenKey); const user = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  const memberships = await directApi(`/ros_organization_members?user_id=eq.${user.sub}&active=eq.true&select=organization_id,role&limit=1`); if (!memberships[0]) throw new Error('Tu cuenta no tiene un restaurante activo asignado.');
  const venues = await directApi(`/ros_venues?organization_id=eq.${memberships[0].organization_id}&status=eq.active&select=id,name,city,slug&limit=1`); if (!venues[0]) throw new Error('No encontramos un local activo.');
  return { id: user.sub, email: user.email, name: user.user_metadata?.name || user.email, role: memberships[0].role, venue_id: venues[0].id, venue: venues[0] };
}
async function directLoad() {
  const profile = await directProfile();
  const [rows, payments] = await Promise.all([
    directApi(`/ros_orders?venue_id=eq.${profile.venue_id}&placed_at=gte.${new Date(new Date().setHours(0, 0, 0, 0)).toISOString()}&order=placed_at.desc&select=*`),
    directApi(`/ros_payments?venue_id=eq.${profile.venue_id}&method=in.(yape,plin)&order=created_at.desc&limit=200&select=id,order_id,method,amount_minor,operation_code,status,confirmed_at,failure_reason`)
  ]);
  const byOrder = Object.fromEntries(payments.map((payment) => [payment.order_id, payment]));
  return { profile, orders: rows.map((order) => ({ ...order, payment: byOrder[order.id] || null })) };
}

function Login({ onLogin }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget); try { const session = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) }); onLogin({ mode: 'bff', csrf: session.csrf_token }); } catch (e) { try { await directAuth(String(form.get('email')), String(form.get('password'))); onLogin({ mode: 'direct' }); } catch (directError) { setError(directError.message); } } finally { setBusy(false); } }
  return <section className="auth-card" aria-labelledby="login-title"><p className="eyebrow">RESTAURANT OS · LIMA</p><h1 id="login-title">Panel de operaciones</h1><p>Gestiona pedidos y confirma pagos Yape o Plin desde tu restaurante.</p><form onSubmit={submit}><label htmlFor="admin-email">Correo<input id="admin-email" name="email" type="email" autoComplete="username" spellCheck={false} required /></label><label htmlFor="admin-password">Contraseña<input id="admin-password" name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="field-error" role="alert">{error}</p>}<button className="primary" type="submit" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar al panel'}</button></form></section>;
}

function Admin() {
  const [me, setMe] = useState(null); const [orders, setOrders] = useState([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [csrf, setCsrf] = useState(''); const [mode, setMode] = useState('bff');
  const load = async (session = { mode, csrf }) => { setBusy(true); setError(''); try { if (session.mode === 'direct') { const loaded = await directLoad(); setMe(loaded.profile); setOrders(loaded.orders); setMode('direct'); } else { const profile = await api('/me'); setMe(profile.user); setCsrf(session.csrf); setMode('bff'); const [rows, reconciliation] = await Promise.all([api('/orders?date=today'), api('/payments/reconciliation')]); const payments = Object.fromEntries((reconciliation.payments || []).map((payment) => [payment.order_id, payment])); setOrders(rows.map((order) => ({ ...order, payment: payments[order.id] || null }))); } } catch (e) { setMe(null); if (!/Inicia sesión/i.test(e.message)) setError(e.message); } finally { setBusy(false); } };
  useEffect(() => { load(); }, []);
  const confirm = async (paymentId, status) => { try { if (mode === 'direct') await directApi('/rpc/ros_confirm_payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_payment_id: paymentId, p_status: status }) }); else await api(`/payments/${paymentId}/confirm`, { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify({ status }) }); await load({ mode, csrf }); } catch (e) { setError(e.message); } };
  if (!me) return <div className="admin-shell"><Login onLogin={load} /></div>;
  const totalMinor = orders.reduce((sum, order) => sum + Number(order.totals?.total_minor || order.total_minor || 0), 0);
  const pendingOrders = orders.filter((order) => ['pending', 'accepted', 'preparing'].includes(order.status)).length;
  const paidOrders = orders.filter((order) => ['paid', 'refunded', 'partially_refunded'].includes(order.payment_status)).length;
  const logout = async () => { try { if (mode === 'bff') await api('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } }); else localStorage.removeItem(tokenKey); setMe(null); } catch (e) { setError(e.message); } };
  return <div className="admin-shell">
    <header className="admin-header"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true">✦</span><div><p className="eyebrow">Restaurant OS</p><p className="brand-name">Mesa de operaciones</p></div></div><div className="account-actions"><span className="account-name">{me.name || me.email}</span><button className="quiet" onClick={logout}>Cerrar sesión</button></div></header>
    <main aria-labelledby="dashboard-title">
      <section className="dashboard-intro"><div><p className="eyebrow accent">Turno en curso</p><h1 id="dashboard-title">Buenos días, {me.name || 'equipo'}.</h1><p className="intro-copy">Una vista clara de lo que necesita atención en tu local hoy.</p></div><div className="live-pill"><span className="live-dot" aria-hidden="true" /> Datos en vivo</div></section>
      {error && <p className="field-error" role="alert">{error}</p>}
      <section className="metric-grid" aria-label="Resumen de hoy" aria-live="polite"><article className="metric-card metric-card-featured"><p className="eyebrow">Ventas registradas</p><strong>{money(totalMinor)}</strong><span>{orders.length} {orders.length === 1 ? 'pedido' : 'pedidos'} de hoy</span></article><article className="metric-card"><p className="eyebrow">En preparación</p><strong>{pendingOrders}</strong><span>Requieren seguimiento</span></article><article className="metric-card"><p className="eyebrow">Pagados</p><strong>{paidOrders}</strong><span>Pedidos con pago registrado</span></article></section>
      <section className="orders-section" aria-labelledby="orders-title"><div className="section-heading"><div><p className="eyebrow accent">La fila</p><h2 id="orders-title">Pedidos de hoy</h2></div><button className="refresh-button" onClick={() => load()} disabled={busy} aria-label="Actualizar pedidos">{busy ? 'Actualizando…' : 'Actualizar ↻'}</button></div><div className="orders-list">{busy && <p className="loading-state">Cargando pedidos…</p>}{!busy && orders.length === 0 && <div className="empty-state"><span className="empty-icon" aria-hidden="true">⌁</span><h3>La fila está tranquila</h3><p>Aquí aparecerán los pedidos cuando lleguen. No hay datos que mostrar todavía.</p></div>}{!busy && orders.map((order) => <article className="order-row" key={order.id}><div className="order-main"><div className="order-number"><span aria-hidden="true">#</span>{order.order_number || order.id}</div><div><h3>{order.customer?.name || order.customer_name || 'Cliente sin nombre'}</h3><p className="order-detail">{order.items?.map((item) => `${item.qty} × ${item.name}`).join(' · ') || 'Detalle no disponible'}</p></div></div><div className="order-meta"><span className={`status status-${order.status}`}>{order.status}</span><strong>{money(order.totals?.total_minor || order.total_minor)}</strong><span className={`payment-label payment-${order.payment_status}`}>{order.payment_status}</span></div></article>)}</div></section>
    </main><footer className="admin-footer"><span>Turno operativo · {me.role}</span><span>Restaurant OS · {mode === 'direct' ? 'conexión directa' : 'BFF'}</span></footer>
  </div>;
}

createRoot(document.getElementById('admin-main')).render(<Admin />);
