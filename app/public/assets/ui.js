/* Restaurant OS — diccionario es-PE centralizado (blueprint §37) + helpers compartidos */
export const esPE = {
  common: { save: 'Guardar', cancel: 'Cancelar', continue: 'Continuar', delete: 'Eliminar', edit: 'Editar', search: 'Buscar', loading: 'Cargando…', retry: 'Intentar nuevamente', close: 'Cerrar', confirm: 'Confirmar', back: 'Volver', today: 'Hoy', view: 'Ver', add: 'Agregar', name: 'Nombre', phone: 'Teléfono', email: 'Correo', price: 'Precio', quantity: 'Cantidad', notes: 'Notas', status: 'Estado', date: 'Fecha', actions: 'Acciones', optional: 'opcional', required: 'obligatorio' },
  auth: { create_account: 'Crear cuenta', login: 'Iniciar sesión', logout: 'Cerrar sesión', recover: 'Recuperar contraseña', verify: 'Verifica tu correo' },
  nav: { storefront: 'Tienda', admin: 'Panel', account: 'Mi cuenta', home: 'Inicio', orders: 'Pedidos', menu: 'Menú', inventory: 'Inventario', customers: 'Clientes', reviews: 'Reseñas', reservations: 'Reservas', analytics: 'Analítica', billing: 'Facturación', team: 'Equipo', audit: 'Auditoría', settings: 'Configuración', promotions: 'Promociones', coupons: 'Cupones', comanda: 'Comandas' },
  orders: { title: 'Pedidos', new: 'Nuevo', accepted: 'Aceptado', preparing: 'En preparación', ready: 'Listo', completed: 'Entregado', cancelled: 'Cancelado', pending: 'Pendiente', unpaid: 'Pendiente de pago', paid: 'Pagado', failed: 'Pago fallido', refunded: 'Reembolsado', partially_refunded: 'Reembolso parcial', pickup: 'Recojo', delivery: 'Delivery', accept: 'Aceptar pedido', start_preparing: 'Comenzar preparación', mark_ready: 'Marcar como listo', mark_delivered: 'Marcar como entregado', cancel_order: 'Cancelar pedido', refund: 'Reembolsar', elapsed: 'Tiempo', details: 'Detalle del pedido' },
  menu: { new_product: 'Nuevo producto', edit_product: 'Editar producto', price: 'Precio', promo_price: 'Precio promocional', track_stock: 'Controlar stock', available: 'Disponible', visible: 'Visible en el menú', save_product: 'Guardar producto', product_ok: 'Producto creado correctamente', product_fail: 'No se pudo guardar el producto', new_category: 'Nueva categoría', category: 'Categoría', description: 'Descripción', emoji: 'Emoji' },
  cart: { title: 'Tu pedido', add: 'Agregar al carrito', view: 'Ver pedido', empty: 'Tu carrito está vacío', checkout: 'Confirmar pedido', coupon: 'Cupón', apply: 'Aplicar', subtotal: 'Subtotal', discount: 'Descuento', delivery_fee: 'Delivery', tax: 'IGV', total: 'Total', customer_data: 'Tus datos', fulfillment: 'Método de entrega', payment: 'Método de pago', name: 'Nombre', phone: 'Teléfono', email: 'Correo (opcional)', address: 'Dirección', reference: 'Referencia', zone: 'Zona de delivery', scheduled: 'Agendar (opcional)' },
  checkout: { success: '¡Pedido recibido!', tracking: 'Sigue tu pedido en tiempo real', pay_now: 'Pagar ahora', card_last4: 'Últimos 4 dígitos', card_brand: 'Marca', paying: 'Procesando pago…', decline_hint: 'Demo: si usas 0001 el pago declina; con 9999 simulas una caída del proveedor.' },
  reviews: { title: 'Reseñas', google: 'Dejar una reseña en Google', private: 'Enviar un comentario privado', rating: 'Calificación', comment: 'Comentario', submit: 'Enviar', thanks: 'Gracias por tu retroalimentación', request: 'Solicitar reseña', points: 'Puntos de reseña', requests: 'Solicitudes', stats: 'Estadísticas', new_point: 'Crear punto de reseña', download_qr: 'Descargar QR', copy_link: 'Copiar enlace' },
  reservations: { title: 'Reservas', make: 'Reservar mesa', party: 'Personas', datetime: 'Fecha y hora', pending: 'Pendiente', confirmed: 'Confirmada', attended: 'Asistió', no_show: 'No asistió', cancelled: 'Cancelada', book: 'Reservar' },
  billing: { title: 'Facturación', plan: 'Plan', current: 'Plan actual', invoices: 'Facturas', upgrade: 'Cambiar plan', cancel_plan: 'Cancelar suscripción', retry: 'Reintentar pago', trial: 'Prueba', trial_days: 'días de prueba' },
  team: { title: 'Equipo', invite: 'Invitar miembro', role: 'Rol', owner: 'Dueño', manager: 'Gerente', kitchen: 'Cocina', cashier: 'Caja', marketing: 'Marketing', viewer: 'Solo lectura' },
  analytics: { title: 'Analítica', sales: 'Ventas', orders_count: 'Pedidos', avg_ticket: 'Ticket promedio', active_orders: 'Pedidos activos', upcoming: 'Próximas reservas', new_reviews: 'Reseñas nuevas', attention: 'Requiere tu atención', opportunities: 'Oportunidades', top_products: 'Productos más vendidos' },
  empty: { orders: 'Aún no hay pedidos. Comparte tu enlace público para recibir el primero.', menu: 'Tu menú está vacío. Crea tu primera categoría y producto.', inventory: 'Sin movimientos de inventario todavía.', customers: 'Los clientes aparecerán cuando lleguen sus primeros pedidos.', reviews: 'Solicita tu primera reseña desde un pedido entregado.', reservations: 'No hay reservas para mostrar.', team: 'Invita a tu primer miembro del equipo.', audit: 'Las acciones sensibles quedarán registradas aquí.', promotions: 'Crea tu primera promoción para impulsar ventas.', coupons: 'Crea tu primer cupón para atraer clientes.' },
  errors: { generic: 'Algo salió mal. Intenta nuevamente.', required: 'Completa este campo.', invalid_email: 'Ingresa un correo válido.', invalid_phone: 'Ingresa un teléfono válido.', network: 'Sin conexión con el servidor.' },
  days: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
};

const moneyFormatter = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 });
export const fmtMoney = (minor) => moneyFormatter.format(Number(minor || 0) / 100).replace('PEN', 'S/');
export const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
export const fmtClock = (iso) => iso ? new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '—';
export const elapsedLabel = (iso) => { const s = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };

export async function api(path, { method = 'GET', body, token } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch('/api/v1' + path, opts);
  let json = null;
  try { json = await res.json(); } catch { /* no json */ }
  if (!res.ok) {
    const err = new Error(json?.error?.message || esPE.errors.generic);
    err.code = json?.error?.code || 'HTTP_' + res.status;
    throw err;
  }
  return json?.data ?? json;
}

export function toast(msg, type = '') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    wrap.setAttribute('aria-atomic', 'true');
    document.body.appendChild(wrap);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

export function modal(html, { title } = {}) {
  const previouslyFocused = document.activeElement;
  const titleId = `modal-title-${crypto.randomUUID()}`;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <div class="split" style="margin-bottom:var(--sp-3)"><h3 id="${titleId}" style="margin:0">${esc(title || '')}</h3>
    <button class="btn btn-ghost btn-sm" data-close aria-label="${esPE.common.close}">✕</button></div>
    <div class="modal-body"></div></div>`;
  document.body.appendChild(back);
  document.body.classList.add('modal-open');
  const bodyEl = back.querySelector('.modal-body');
  bodyEl.innerHTML = html;
  const dialog = back.querySelector('[role="dialog"]');
  const heading = title ? back.querySelector(`#${titleId}`) : bodyEl.querySelector('h1, h2, h3, h4');
  if (heading) {
    heading.id ||= titleId;
    dialog.setAttribute('aria-labelledby', heading.id);
    if (!title) back.querySelector(`#${titleId}`).classList.add('hide');
  } else {
    back.querySelector(`#${titleId}`).classList.add('hide');
    dialog.setAttribute('aria-label', 'Ventana de acción');
  }
  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    back.remove();
    if (!document.querySelector('.modal-back')) document.body.classList.remove('modal-open');
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKeyDown);
  back.querySelector('[data-close]').onclick = close;
  back.onclick = (e) => { if (e.target === back) close(); };
  requestAnimationFrame(() => (bodyEl.querySelector('[autofocus], input, select, textarea, button, a[href]') || back.querySelector('[data-close]'))?.focus());
  return { el: back, body: bodyEl, close };
}

export function statusBadge(status) {
  const map = {
    pending: ['pending', 'Nuevo'], accepted: ['accepted', 'Aceptado'], preparing: ['preparing', 'En preparación'],
    ready: ['ready', 'Listo'], completed: ['completed', 'Entregado'], cancelled: ['cancelled', 'Cancelado'],
    unpaid: ['unpaid', 'Pendiente de pago'], paid: ['paid', 'Pagado'], failed: ['failed', 'Pago fallido'],
    refunded: ['refunded', 'Reembolsado'], partially_refunded: ['partially_refunded', 'Reembolso parcial'],
    confirmed: ['confirmed', 'Confirmada'], attended: ['attended', 'Asistió'], no_show: ['no_show', 'No asistió'],
    scheduled: ['scheduled', 'Programada'], sent: ['sent', 'Enviada'], opened: ['opened', 'Abierta'],
  };
  const [cls, label] = map[status] || [status, status];
  return `<span class="badge ${status === 'completed' || status === 'paid' || status === 'attended' || status === 'confirmed' || status === 'sent' || status === 'opened' ? 'ok' : status === 'cancelled' || status === 'failed' || status === 'no_show' ? 'err' : status === 'preparing' || status === 'ready' || status === 'scheduled' ? 'warn' : status === 'pending' ? 'accent' : ''}">${label}</span>`;
}

export function emptyState(icon, text) {
  return `<div class="empty"><div class="ico">${icon}</div><p style="margin:0">${text}</p></div>`;
}
export function skeletonRows(n = 3) {
  return Array.from({ length: n }, () => `<div class="skeleton" style="margin-bottom:12px"></div>`).join('');
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
