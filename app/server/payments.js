// Adaptadores de pago: mock únicamente para desarrollo/pruebas y Stripe opcional.
// Nunca recibe ni almacena números completos de tarjeta (PCI scope reducido).
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export class ProviderOutageError extends Error { constructor(message = 'provider_unavailable') { super(message); this.code = 'provider_unavailable'; } }
export class PaymentProviderError extends Error { constructor(code, message = code) { super(message); this.code = code; } }
const mode = () => process.env.PAYMENTS_MODE || 'mock';
const stripeKey = () => process.env.STRIPE_SECRET_KEY || '';
const stripeApi = 'https://api.stripe.com/v1';
const form = (values) => new URLSearchParams(Object.entries(values).filter(([, v]) => v !== undefined && v !== null));

async function stripeRequest(path, values) {
  if (!stripeKey()) throw new PaymentProviderError('provider_not_configured', 'Stripe no está configurado.');
  let response;
  try { response = await fetch(`${stripeApi}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${stripeKey()}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(values) }); }
  catch { throw new ProviderOutageError(); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const code = data?.error?.code || (response.status >= 500 ? 'provider_unavailable' : 'payment_failed'); if (code === 'provider_unavailable') throw new ProviderOutageError(); throw new PaymentProviderError(code, data?.error?.message || code); }
  return data;
}

const mockProvider = {
  async charge({ amountMinor, currency = 'PEN', cardLast4 = '', cardBrand = '', orderRef }) {
    if (process.env.PAYMENTS_FAIL_MODE === 'outage' || cardLast4 === '9999') throw new ProviderOutageError();
    if (process.env.PAYMENTS_FAIL_MODE === 'decline' || cardLast4 === '0001') throw new PaymentProviderError('card_declined');
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true, status: 'succeeded', externalRef: `mock_${randomUUID()}`, provider: 'mock', cardLast4, cardBrand, amountMinor, currency, orderRef };
  },
  async refund({ externalRef, amountMinor, currency = 'PEN' }) { if (process.env.PAYMENTS_FAIL_MODE === 'outage') throw new ProviderOutageError(); await new Promise((r) => setTimeout(r, 15)); return { ok: true, refundRef: `mrf_${randomUUID()}`, provider: 'mock', externalRef, amountMinor, currency }; },
};

const stripeProvider = {
  async charge({ amountMinor, currency = 'PEN', paymentMethodId, orderRef }) {
    if (!paymentMethodId) throw new PaymentProviderError('payment_method_required', 'Se requiere un payment_method de Stripe.');
    const intent = await stripeRequest('/payment_intents', { amount: String(amountMinor), currency: currency.toLowerCase(), payment_method: paymentMethodId, confirm: 'true', 'metadata[order_id]': String(orderRef || '') });
    if (intent.status === 'succeeded') return { ok: true, status: intent.status, externalRef: intent.id, provider: 'stripe' };
    if (intent.status === 'requires_action' || intent.status === 'requires_confirmation') return { ok: false, status: intent.status, externalRef: intent.id, clientSecret: intent.client_secret, provider: 'stripe' };
    throw new PaymentProviderError(intent.last_payment_error?.code || 'payment_failed');
  },
  async refund({ externalRef, amountMinor }) { const refund = await stripeRequest('/refunds', { payment_intent: externalRef, amount: String(amountMinor) }); return { ok: true, refundRef: refund.id, provider: 'stripe' }; },
};

export const paymentProvider = { charge: (args) => (mode() === 'stripe' ? stripeProvider : mockProvider).charge(args), refund: (args) => (mode() === 'stripe' ? stripeProvider : mockProvider).refund(args) };
export const paymentProviderName = () => mode() === 'stripe' ? 'stripe' : 'mock';

export function verifyWebhookSignature(payload, signature, secret, toleranceSeconds = 300) {
  if (!secret || !signature || typeof payload !== 'string') return false;
  const parts = Object.fromEntries(String(signature).split(',').map((p) => p.split('=')));
  const timestamp = Number(parts.t); if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds || !parts.v1) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  try { return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(parts.v1, 'hex')); } catch { return false; }
}
export function webhookSecret() { return process.env.STRIPE_WEBHOOK_SECRET || ''; }
export function reconcilePayments(db, { venueId = null } = {}) {
  const where = venueId == null ? '' : ' WHERE p.venue_id = ?'; const args = venueId == null ? [] : [venueId];
  return db.prepare(`SELECT p.id, p.order_id, p.venue_id, p.amount_minor, p.status, p.provider, p.external_ref, p.updated_at, o.payment_status AS order_payment_status FROM payments p JOIN orders o ON o.id=p.order_id${where}${where ? ' AND' : ' WHERE'} ((p.status='succeeded' AND o.payment_status NOT IN ('paid','refunded','partially_refunded')) OR (p.status IN ('refunded','partially_refunded') AND o.payment_status NOT IN ('refunded','partially_refunded'))) ORDER BY p.id`).all(...args);
}
