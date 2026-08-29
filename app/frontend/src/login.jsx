import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const config = window.__ROS_CONFIG__ || {};
const directEnabled = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(String(config.supabaseUrl || '')) && String(config.supabaseAnonKey || '').length > 20 && !String(config.supabaseAnonKey).startsWith('TU_');
function Login() {
  const params = new URLSearchParams(location.search); const [role, setRole] = useState(params.get('role') === 'customer' ? 'customer' : 'restaurant'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    const credentials = { email: form.get('email'), password: form.get('password') };
    try {
      // El panel completo usa la sesión HttpOnly del BFF para aplicar RBAC en
      // cada módulo. Solo el acceso cliente usa la sesión pública de Supabase.
      if (role === 'restaurant') {
        const bff = await fetch('./api/v1/auth/login', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
        const bffBody = await bff.json().catch(() => ({}));
        if (bff.ok && bffBody.data?.user) {
          const requestedReturn = params.get('return'); const safeReturn = requestedReturn && requestedReturn.startsWith('/') && !requestedReturn.startsWith('//') ? requestedReturn : null;
          location.href = safeReturn || './restaurante.html'; return;
        }
        if (bffBody.error?.message) throw new Error(bffBody.error.message);
      }
      if (role === 'customer') {
        const bff = await fetch('./api/v1/auth/customer-login', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
        const bffBody = await bff.json().catch(() => ({}));
        if (bff.ok && bffBody.data?.user) {
          localStorage.setItem('ros_customer_session', 'bff');
          // Marcador local no sensible: el token real permanece en cookie HttpOnly.
          localStorage.setItem('ros_customer_access_token', 'bff');
          const requestedReturn = params.get('return'); const safeReturn = requestedReturn && requestedReturn.startsWith('/') && !requestedReturn.startsWith('//') ? requestedReturn : null;
          location.href = safeReturn || './cliente.html'; return;
        }
        if (bffBody.error?.code === 'INVALID_CREDENTIALS' || bffBody.error?.code === 'CUSTOMER_ACCESS_REQUIRED') throw new Error(bffBody.error.message);
      }
      if (!directEnabled) throw new Error('La configuración de acceso aún no está disponible.');
      const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.supabaseAnonKey }, body: JSON.stringify(credentials) });
      const body = await response.json().catch(() => ({})); if (!response.ok || !body.access_token) throw new Error('Correo o contraseña incorrectos.');
      localStorage.setItem(role === 'restaurant' ? 'ros_admin_access_token' : 'ros_customer_access_token', body.access_token);
      const requestedReturn = params.get('return'); const safeReturn = requestedReturn && requestedReturn.startsWith('/') && !requestedReturn.startsWith('//') ? requestedReturn : null;
      location.href = safeReturn || (role === 'restaurant' ? './restaurante.html' : './cliente.html');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <main className="auth-shell"><section className="auth-promo"><a className="foodipro-logo inverse" href="/"><span className="logo-tile">FP</span><span>Foodi<span>Pro</span></span></a><div className="auth-promo-copy"><p className="eyebrow">Operación sin fricción</p><h1>Gestiona tu negocio y tus pedidos desde <em>un solo lugar.</em></h1><p>La plataforma para restaurantes y clientes que quieren comer mejor, juntos.</p></div><div className="auth-preview"><img src="/foodipro-restaurant-reference.webp" alt="Vista previa del dashboard operativo de FoodiPro" /></div><div className="auth-audience"><span>▦</span><p><strong>Para restaurantes</strong><br />Gestiona pedidos, menú y ventas.</p><span>◌</span><p><strong>Para clientes</strong><br />Explora y disfruta.</p></div></section><section className="auth-form-panel"><a className="foodipro-logo" href="/"><span className="logo-tile">FP</span><span>Foodi<span>Pro</span></span></a><div className="auth-form-content"><p className="eyebrow">Bienvenido de nuevo</p><h2>Iniciar sesión</h2><p className="auth-subtitle">Accede a tu cuenta para continuar.</p><div className="role-switch" role="group" aria-label="Tipo de acceso"><button type="button" className={role === 'restaurant' ? 'selected' : ''} onClick={() => setRole('restaurant')}>▦ Acceso restaurante</button><button type="button" className={role === 'customer' ? 'selected' : ''} onClick={() => setRole('customer')}>◌ Acceso cliente</button></div><form onSubmit={submit}><label htmlFor="login-email">Correo electrónico<input id="login-email" name="email" type="email" autoComplete="username" placeholder="tu@correo.com" required /></label><label htmlFor="login-password">Contraseña<input id="login-password" name="password" type="password" autoComplete="current-password" placeholder="••••••••••••" required /></label><div className="auth-options"><label className="remember"><input type="checkbox" name="remember" /> <span>Recordarme</span></label><a href="mailto:soporte@foodipro.pe">¿Olvidaste tu contraseña?</a></div>{error && <p className="field-error" role="alert">{error}</p>}<button className="auth-submit" disabled={busy} type="submit">{busy ? 'Ingresando…' : 'Ingresar'} <span>→</span></button></form><p className="auth-foot">¿Aún no tienes cuenta? <a href="mailto:hola@foodipro.pe">Crear cuenta</a></p></div><p className="security-note">◉ <span><strong>Acceso seguro para restaurantes y clientes</strong><br />Tus datos se protegen con cifrado.</span></p></section></main>;
}
createRoot(document.getElementById('login-root')).render(<Login />);
