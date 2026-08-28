import { useEffect, useMemo, useState } from 'react';

const slug = import.meta.env.VITE_VENUE_SLUG || 'casa-aurora';
const money = (minor = 0) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(minor / 100);

async function getJson(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'No pudimos cargar el menú.');
  return body.data;
}

export default function App() {
  const [venue, setVenue] = useState(null);
  const [menu, setMenu] = useState(null);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkout, setCheckout] = useState(false);
  const [submitted, setSubmitted] = useState(null);

  const load = () => {
    setLoading(true); setError('');
    Promise.all([getJson(`/api/v1/public/venues/${slug}`), getJson(`/api/v1/public/venues/${slug}/menu`)]).then(([v, m]) => { setVenue(v); setMenu(m); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const products = useMemo(() => (menu?.categories || []).flatMap((category) => (category.products || []).map((product) => ({ ...product, category: category.name }))).filter((product) => `${product.name} ${product.description || ''}`.toLowerCase().includes(query.toLowerCase())), [menu, query]);
  const add = (product) => setCart((items) => { const found = items.find((item) => item.id === product.id); return found ? items.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item) : [...items, { ...product, qty: 1 }]; });
  const total = cart.reduce((sum, item) => sum + item.price_minor * item.qty, 0);
  const submitOrder = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const method = String(form.get('method'));
    const operationCode = String(form.get('operation_code') || '').trim();
    const body = { customer: { name: form.get('name'), phone: form.get('phone'), email: form.get('email') || null }, fulfillment: { type: 'pickup' }, notes: '', items: cart.map((item) => ({ product_id: item.id, quantity: item.qty, option_ids: [] })), idempotency_key: crypto.randomUUID() };
    const response = await fetch(`/api/v1/public/venues/${slug}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || 'No pudimos registrar tu pedido.');
    let order = data.data;
    if ((method === 'yape' || method === 'plin') && operationCode) {
      const payResponse = await fetch(`/api/v1/public/venues/${slug}/orders/${order.public_token}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ payment_method: method, operation_code: operationCode }) });
      const payData = await payResponse.json().catch(() => ({}));
      if (!payResponse.ok) throw new Error(payData.error?.message || 'No pudimos registrar el pago.');
      order = { ...order, payment_status: payData.data?.payment_status || 'pending_verification' };
    }
    setSubmitted({ ...order, method, operationCode }); setCart([]); setCheckout(false);
  };

  if (loading) return <main className="shell"><p className="eyebrow">RESTAURANT OS · LIMA</p><h1>Cargando carta…</h1></main>;
  if (error) return <main className="shell"><p className="eyebrow">NO DISPONIBLE</p><h1>No pudimos abrir este menú</h1><p>{error}</p><button onClick={load}>Reintentar</button></main>;
  return <main className="shell">
    <header className="hero"><div><p className="eyebrow">{venue.city || 'Lima'} · {venue.is_open ? 'ABIERTO' : 'CERRADO'}</p><h1>{venue.name}</h1><p>{venue.address || 'Pide para recojo o delivery.'}</p></div><div className="cover" aria-hidden="true">{venue.cover_emoji || '🍽️'}</div></header>
    <label className="search">Buscar en la carta<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ceviche, lomo…" /></label>
    <section className="grid" aria-live="polite">{products.map((product) => <article className="card" key={product.id}><div><p className="eyebrow">{product.category}</p><h2>{product.name}</h2><p>{product.description}</p><strong>{money(product.promo_price_minor || product.price_minor)}</strong></div><button onClick={() => add(product)} aria-label={`Agregar ${product.name}`}>Agregar</button></article>)}</section>
    {submitted && <section className="notice" role="status"><strong>Pedido recibido</strong><p>Guarda tu código: <b>{submitted.order?.public_token || submitted.public_token || 'registrado'}</b>. {submitted.method === 'yape' || submitted.method === 'plin' ? `Verificaremos tu ${submitted.method.toUpperCase()} con el código ${submitted.operationCode || 'pendiente'}.` : 'Te contactaremos para coordinar.'}</p></section>}
    {checkout && <section className="checkout" aria-labelledby="checkout-title"><h2 id="checkout-title">Confirmar pedido</h2><form onSubmit={(event) => { submitOrder(event).catch((e) => setError(e.message)); }}><label>Nombre<input name="name" required autoComplete="name" /></label><label>Celular<input name="phone" required inputMode="tel" autoComplete="tel" placeholder="987 654 321" /></label><label>Correo (opcional)<input name="email" type="email" autoComplete="email" /></label><label>Forma de pago<select name="method" defaultValue="yape"><option value="yape">Yape</option><option value="plin">Plin</option><option value="cash">Efectivo al recoger</option></select></label><label>Código de operación (si ya pagaste)<input name="operation_code" inputMode="numeric" /></label><div className="actions"><button type="button" onClick={() => setCheckout(false)}>Volver</button><button className="primary" type="submit">Enviar pedido · {money(total)}</button></div></form></section>}
    <aside className="cart" aria-label="Tu pedido"><div><strong>{cart.reduce((sum, item) => sum + item.qty, 0)} productos</strong><span>{money(total)}</span></div>{cart.map((item) => <div className="cart-row" key={item.id}><span>{item.qty} × {item.name}</span><span>{money(item.price_minor * item.qty)}</span></div>)}{cart.length > 0 && <button className="primary" onClick={() => setCheckout(true)}>Continuar al pedido</button>}</aside>
  </main>;
}
