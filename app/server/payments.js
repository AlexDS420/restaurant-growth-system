// Restaurant OS — adaptador de pagos (PaymentProviderInterface, blueprint §26/§30.6)
// Mock: simula success / decline / outage según tarjeta o env. Nunca almacena datos de tarjeta.
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

export class ProviderOutageError extends Error {
  constructor() { super('provider_unavailable'); this.code = 'provider_unavailable'; }
}

export const paymentProvider = {
  async charge({ amountMinor, currency = 'PEN', cardLast4 = '', cardBrand = '', orderRef }) {
    if (config.paymentsFailMode === 'outage' || cardLast4 === '9999') throw new ProviderOutageError();
    if (config.paymentsFailMode === 'decline' || cardLast4 === '0001') {
      const e = new Error('card_declined');
      e.code = 'card_declined';
      throw e;
    }
    await sleep(60); // simula latencia de red ~60ms
    return { ok: true, externalRef: 'mock_' + randomUUID(), provider: 'mock', cardLast4, cardBrand };
  },
  async refund({ externalRef, amountMinor, currency = 'PEN' }) {
    if (config.paymentsFailMode === 'outage') throw new ProviderOutageError();
    await sleep(40);
    return { ok: true, refundRef: 'mrf_' + randomUUID() };
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));