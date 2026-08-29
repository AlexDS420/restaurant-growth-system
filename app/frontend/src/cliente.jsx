import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const tokenKey = 'ros_customer_access_token';

function CustomerDashboard() {
  const [email, setEmail] = useState('');
  useEffect(() => {
    const token = localStorage.getItem(tokenKey);
    if (!token) {
      location.href = '/login.html?role=customer&return=%2Fcliente.html';
      return;
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      setEmail(payload.email || 'comensal');
    } catch {
      localStorage.removeItem(tokenKey);
      location.href = '/login.html?role=customer&return=%2Fcliente.html';
    }
  }, []);

  const logout = () => {
    localStorage.removeItem(tokenKey);
    location.href = '/';
  };

  return <div className="customer-shell">
    <header className="customer-header">
      <a className="foodipro-logo" href="/" aria-label="FoodiPro inicio"><span className="logo-tile">FP</span><span>Foodi<span>Pro</span></span></a>
      <div className="customer-actions"><a className="customer-menu-link" href="/carta.html?venue=casa-aurora">Explorar carta <span>→</span></a><span className="customer-email">{email}</span><button className="quiet" onClick={logout}>Cerrar sesión</button></div>
    </header>
    <main className="customer-main">
      <section className="customer-welcome"><div><p className="eyebrow accent">Tu espacio FoodiPro</p><h1>Hola, {email ? email.split('@')[0] : 'comensal'}.</h1><p>Descubre nuevos sabores, revisa tus pedidos y vuelve a pedir tus favoritos.</p><a className="customer-primary" href="/carta.html?venue=casa-aurora">Ver la carta <span>→</span></a></div><div className="customer-welcome-art" aria-hidden="true">🍔</div></section>
      <section className="customer-dashboard-grid">
        <article className="customer-panel customer-orders"><div className="section-heading"><div><p className="eyebrow">Actividad</p><h2>Mis pedidos</h2></div><a href="/carta.html?venue=casa-aurora">Nuevo pedido</a></div><div className="customer-empty"><span aria-hidden="true">⌁</span><h3>Aún no tienes pedidos</h3><p>Cuando realices tu primer pedido aparecerá aquí su estado y código de seguimiento.</p><a className="text-button" href="/carta.html?venue=casa-aurora">Explorar restaurantes →</a></div></article>
        <aside className="customer-panel customer-side"><p className="eyebrow">Tu próxima comida</p><h2>Casa Aurora</h2><p>Menú digital · Lima, Perú</p><a className="customer-secondary" href="/carta.html?venue=casa-aurora">Ver carta</a></aside>
      </section>
    </main>
  </div>;
}

createRoot(document.getElementById('customer-root')).render(<CustomerDashboard />);
