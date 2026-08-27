// Restaurant OS — outbox de notificaciones (blueprint §27/§28): la notificación NUNCA controla la transacción
import { nowISO } from './db.js';
import { config } from './config.js';

export const NOTIFICATION_TEMPLATES = {
  order_created_customer: { subject: 'Tu pedido fue recibido', button: 'Ver estado del pedido' },
  order_created_business: { subject: 'Nuevo pedido recibido', button: 'Ver pedido' },
  order_ready_customer: { subject: 'Tu pedido está listo', button: 'Ver estado del pedido' },
  reservation_created: { subject: 'Solicitud de reserva recibida', button: 'Ver reserva' },
  reservation_confirmed: { subject: 'Reserva confirmada', button: 'Ver reserva' },
  review_request: { subject: 'Cuéntanos sobre tu experiencia', button: 'Dejar reseña' },
  staff_invitation: { subject: 'Has sido invitado a Restaurant OS', button: 'Unirme' },
  trial_expiring: { subject: 'Tu prueba Pro está por vencer', button: 'Ver mi plan' },
  subscription_activated: { subject: 'Tu suscripción está activa', button: 'Ver mi plan' },
  payment_failed: { subject: 'No pudimos procesar tu pago', button: 'Reintentar pago' },
};

export function enqueueOutbox(db, { venueId, eventType, entityType, entityId, payload = {} }) {
  db.prepare(`INSERT INTO outbox_events (venue_id, event_type, entity_type, entity_id, payload_json, status, next_attempt_at)
    VALUES (?,?,?,?,?, 'pending', ?)`).run(venueId, eventType, entityType, String(entityId), JSON.stringify(payload), nowISO());
  return { venueId, eventType, entityType, entityId };
}

// Notifier pluggable (D-03): console/archivo. En producción: EmailJS/WhatsApp vía proveedor.
export function notify({ eventType, to = null, payload = {} }) {
  const tpl = NOTIFICATION_TEMPLATES[eventType] || { subject: eventType };
  const line = `[notifier] ${eventType} → ${to ?? 'interno'} | ${tpl.subject} | ${JSON.stringify(payload).slice(0, 160)}`;
  console.log(line);
  return { ok: true, channel: 'log' };
}

export function startOutboxWorker(db, { onFailed } = {}) {
  const run = () => {
    try {
      const now = nowISO();
      const due = db.prepare(`SELECT * FROM outbox_events WHERE status IN ('pending','processing') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY id LIMIT 10`).all(now);
      for (const ev of due) {
        db.prepare(`UPDATE outbox_events SET status='processing', attempts=attempts+1 WHERE id=?`).run(ev.id);
        const payload = (() => { try { return JSON.parse(ev.payload_json); } catch { return {}; } })();
        try {
          const res = notify({ eventType: ev.event_type, to: payload.to ?? null, payload });
          db.prepare(`UPDATE outbox_events SET status='processed', processed_at=?, last_error=NULL, next_attempt_at=NULL WHERE id=?`).run(nowISO(), ev.id);
        } catch (err) {
          const attempts = db.prepare('SELECT attempts FROM outbox_events WHERE id=?').get(ev.id).attempts;
          if (attempts >= config.outboxMaxAttempts) {
            db.prepare(`UPDATE outbox_events SET status='failed', last_error=?, next_attempt_at=NULL WHERE id=?`).run(String(err.message || err).slice(0, 500), ev.id);
            onFailed?.(ev);
          } else {
            const backoff = Math.min(300000, 5000 * 2 ** attempts);
            db.prepare(`UPDATE outbox_events SET status='pending', last_error=?, next_attempt_at=? WHERE id=?`).run(String(err.message || err).slice(0, 500), new Date(Date.now() + backoff).toISOString(), ev.id);
          }
        }
      }
    } catch (e) {
      console.error('[outbox] worker error:', e.message);
    }
  };
  run();
  const timer = setInterval(run, config.outboxIntervalMs);
  timer.unref?.();
  return timer;
}