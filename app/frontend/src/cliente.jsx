import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const tokenKey = 'ros_customer_access_token';

function CustomerDashboard() {
  const [email, setEmail] = useState('');
  useEffect(() => { (async () => {
    const token = localStorage.getItem(tokenKey);
    // El BFF usa una cookie HttpOnly; el valor local "bff" solo indica que
    // debemos validar esa cookie mediante /api/v1/me, nunca decodificarlo.
    const bffSession = localStorage.getItem('ros_customer_session') === 'bff' || token === 'bff';
    if (!token && !bffSession) {
      location.href = '/login.html?role=customer&return=%2Fcliente.html';
      return;
    }
    try {
      if (bffSession) {
        const response = await fetch('/api/v1/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.data?.user?.role !== 'customer') throw new Error('Sesión de cliente no válida.');
        setEmail(body.data.user.email || 'comensal'); return;
      }
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      setEmail(payload.email || 'comensal');
    } catch {
      localStorage.removeItem(tokenKey);
      location.href = '/login.html?role=customer&return=%2Fcliente.html';
    }
  })(); }, []);

  const logout = () => {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem('ros_customer_session');
    fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.href = '/carta.html?venue=casa-aurora&section=carta';
  };

  const carta = '/carta.html?venue=casa-aurora&section=carta';
  return <div className="customer-shell foodie-customer">
    <header className="customer-header foodie-customer-header">
      <a className="foodipro-logo" href="/" aria-label="FoodiPro inicio"><span className="logo-tile">✦</span><span>Foodi<span>Pro</span></span></a>
      <label className="customer-search"><span aria-hidden="true">⌕</span><span className="sr-only">Buscar</span><input placeholder="Buscar restaurantes o platos..." /></label>
      <div className="customer-actions"><button className="customer-icon" type="button" aria-label="Cambiar tema">☼</button><button className="customer-icon" type="button" aria-label="Notificaciones">♧</button><a className="customer-account" href="#account" aria-label={`Cuenta de ${email}`}>◎ <span>{email ? email.split('@')[0] : 'Comensal'}</span></a><button className="quiet" onClick={logout}>Salir</button></div>
    </header>
    <div className="customer-layout">
      <aside className="customer-sidebar" aria-label="Navegación del comensal"><a className="customer-side-icon active" href="#dashboard" aria-label="Inicio">▦</a><a className="customer-side-icon" href={carta} aria-label="Carta">♧</a><a className="customer-side-icon" href="#orders" aria-label="Mis pedidos">▤</a><a className="customer-side-icon" href="#favorites" aria-label="Favoritos">♡</a><a className="customer-side-icon" href={carta} aria-label="Carrito">▢</a></aside>
      <main className="customer-main" id="dashboard">
        <section className="customer-welcome foodie-customer-hero"><div className="customer-hero-copy"><p className="eyebrow accent">FoodiPro · Lima, Perú</p><h1>Vive para comer.<br /><em>No comas para vivir.</em></h1><p>Descubre sabores increíbles cerca de ti y disfruta cada pedido sin complicaciones.</p><a className="customer-primary" href={carta}>Explorar la carta <span>→</span></a></div><div className="customer-welcome-art" aria-hidden="true"><img src="/foodipro-customer-reference.webp" alt="" /></div></section>
        <section className="customer-dashboard-grid foodie-customer-grid">
          <div className="customer-main-column"><article className="customer-panel customer-categories"><div className="section-heading"><div><p className="eyebrow">Descubre</p><h2>Categorías</h2></div><a href={carta}>Ver todas <span>→</span></a></div><div className="customer-category-list"><a href={carta} className="customer-category"><span>🍩</span><strong>Postres</strong></a><a href={`${carta}&category=burger`} className="customer-category selected"><span>🍔</span><strong>Hamburguesas</strong></a><a href={carta} className="customer-category"><span>☕</span><strong>Bebidas</strong></a></div></article><article className="customer-panel customer-orders" id="orders"><div className="section-heading"><div><p className="eyebrow">Actividad</p><h2>Pedidos recientes</h2></div><a href={carta}>Nuevo pedido <span>→</span></a></div><div className="customer-empty"><span aria-hidden="true">⌁</span><h3>Aún no tienes pedidos</h3><p>Cuando realices tu primer pedido aparecerá aquí su estado y código de seguimiento.</p><a className="text-button" href={carta}>Explorar restaurantes →</a></div></article></div>
          <aside className="customer-panel customer-side customer-order-summary"><p className="eyebrow">Tu resumen</p><h2>Tu pedido</h2><p className="customer-muted">Añade tus favoritos desde la carta.</p><div className="customer-balance"><span>Total actual</span><strong>S/ 0.00</strong></div><div className="customer-address"><span>⌖</span><div><strong>Casa Aurora</strong><small>Recojo · Lima, Perú</small></div></div><a className="customer-secondary" href={carta}>Ver carta <span>→</span></a></aside>
        </section>
      </main>
    </div>
  </div>;
}

createRoot(document.getElementById('customer-root')).render(<CustomerDashboard />);
