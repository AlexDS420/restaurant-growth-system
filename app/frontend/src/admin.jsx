import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const money = (minor = 0) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(minor / 100);
async function api(path, options = {}) {
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'No se pudo completar la operación.');
  return body.data;
}

function Login({ onLogin }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget); try { const session = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) }); onLogin(session.csrf_token); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <section className="auth-card" aria-labelledby="login-title"><p className="eyebrow">RESTAURANT OS · LIMA</p><h1 id="login-title">Panel de operaciones</h1><p>Gestiona pedidos y confirma pagos Yape o Plin desde tu restaurante.</p><form onSubmit={submit}><label htmlFor="admin-email">Correo<input id="admin-email" name="email" type="email" autoComplete="username" spellCheck={false} required /></label><label htmlFor="admin-password">Contraseña<input id="admin-password" name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="field-error" role="alert">{error}</p>}<button className="primary" type="submit" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar al panel'}</button></form></section>;
}

function Admin() {
  const [me, setMe] = useState(null); const [orders, setOrders] = useState([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [csrf, setCsrf] = useState('');
  const load = async (newCsrf = csrf) => { setBusy(true); setError(''); try { const profile = await api('/me'); setMe(profile.user); setCsrf(newCsrf); const [rows, reconciliation] = await Promise.all([api('/orders?date=today'), api('/payments/reconciliation')]); const payments = Object.fromEntries((reconciliation.payments || []).map((payment) => [payment.order_id, payment])); setOrders(rows.map((order) => ({ ...order, payment: payments[order.id] || null }))); } catch (e) { setMe(null); if (!/Inicia sesión/i.test(e.message)) setError(e.message); } finally { setBusy(false); } };
  useEffect(() => { load(); }, []);
  const confirm = async (paymentId, status) => { try { await api(`/payments/${paymentId}/confirm`, { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify({ status }) }); await load(); } catch (e) { setError(e.message); } };
  if (!me) return <main className="admin-shell"><Login onLogin={load} /></main>;
  return <main className="admin-shell"><header className="admin-header"><div><p className="eyebrow">{me.name || me.email}</p><h1>Pedidos de hoy</h1><p>{me.role} · operaciones del local</p></div><button onClick={async () => { await api('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } }); setMe(null); }}>Cerrar sesión</button></header>{error && <p className="field-error" role="alert">{error}</p>}<section className="admin-card" aria-live="polite">{busy && <p>Cargando pedidos…</p>}{!busy && orders.length === 0 && <div className="empty-state"><h2>Sin pedidos pendientes</h2><p>Los pedidos nuevos aparecerán aquí cuando lleguen.</p></div>}{orders.map((order) => <article className="order-row" key={order.id}><div><p className="eyebrow">{order.status} · {order.payment_status}</p><h2>{order.customer?.name || 'Cliente'} <span className="order-total">{money(order.totals?.total_minor || order.total_minor)}</span></h2><p>{order.items?.map((item) => `${item.qty} × ${item.name}`).join(' · ') || 'Detalle no disponible'}</p></div><div className="order-actions">{order.payment?.status === 'verifying' && <><button onClick={() => confirm(order.payment.id, 'confirmed')}>Confirmar pago</button><button className="quiet" onClick={() => confirm(order.payment.id, 'rejected')}>Rechazar</button></>}</div></article>)}</section></main>;
}

createRoot(document.getElementById('admin-main')).render(<Admin />);
