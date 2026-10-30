import { createHash, createHmac } from 'node:crypto';
import { pool } from './db.js';
import { getProviderAccount } from './providers.js';
import { safeEqual } from './crypto.js';
import { applyOrderState, markPaidFromProvider } from './order-service.js';

function parseBody(raw) {
  try { return JSON.parse(raw.toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON webhook'), { status: 400, code: 'invalid_webhook' }); }
}

function razorpayValid(raw, signature, secret) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  return safeEqual(expected, signature, 'hex');
}

function cashfreeValid(raw, signature, timestamp, secret) {
  if (!signature || !timestamp || !/^\d{10,16}$/.test(timestamp)) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}${raw.toString('utf8')}`).digest('base64');
  return safeEqual(expected, signature);
}

async function persistEvent(account, eventId, type, raw) {
  const result = await pool.query(
    `INSERT INTO provider_webhook_events (provider_account_id, event_id, event_type, payload_sha256)
     VALUES ($1,$2,$3,$4) ON CONFLICT (provider_account_id, event_id) DO NOTHING RETURNING id`,
    [account.id, eventId, type, createHash('sha256').update(raw).digest('hex')]
  );
  return result.rowCount === 1;
}

async function findLocalOrder(accountId, providerOrderId, rawOrderId) {
  const orderId = rawOrderId || null;
  const result = await pool.query(
    `SELECT id, amount_minor, currency FROM payment_orders
     WHERE provider_account_id = $1 AND (provider_order_id = $2 OR id::text = $3 OR replace(id::text, '-', '') = $3)
     LIMIT 1`, [accountId, providerOrderId || '', orderId || '']
  );
  return result.rows[0] || null;
}

export async function handleProviderWebhook(provider, tenantSlug, req, res) {
  if (!Buffer.isBuffer(req.body)) return res.status(415).end();
  const tenantResult = await pool.query('SELECT id FROM tenants WHERE slug = $1 AND active = TRUE', [tenantSlug]);
  const tenant = tenantResult.rows[0];
  if (!tenant) return res.status(404).end();
  const account = await getProviderAccount(tenant.id, provider);
  const c = account.credentials;
  const raw = req.body;
  const timestamp = req.get('x-webhook-timestamp') || '';
  const signature = req.get('x-webhook-signature') || '';
  if (provider === 'razorpay' && !razorpayValid(raw, req.get('x-razorpay-signature'), c.webhookSecret)) return res.status(400).end();
  if (provider === 'cashfree' && !cashfreeValid(raw, signature, timestamp, c.webhookSecret)) return res.status(400).end();

  const event = parseBody(raw);
  const eventType = provider === 'razorpay' ? String(event.event || 'unknown') : String(event.type || event.event || 'unknown');
  const eventId = provider === 'razorpay'
    ? (req.get('x-razorpay-event-id') || createHash('sha256').update(raw).digest('hex'))
    : (req.get('x-idempotency-header') || createHash('sha256').update(`${timestamp}.${raw}`).digest('hex'));
  const seen = await pool.query('SELECT 1 FROM provider_webhook_events WHERE provider_account_id = $1 AND event_id = $2', [account.id, eventId]);
  if (seen.rowCount) return res.status(200).json({ received: true, duplicate: true });

  let providerOrderId, rawOrderId, nextState, amountMinor, currency;
  if (provider === 'razorpay') {
    const payment = event.payload?.payment?.entity;
    const order = event.payload?.order?.entity;
    providerOrderId = payment?.order_id || order?.id;
    rawOrderId = payment?.notes?.technext_order_id || order?.notes?.technext_order_id;
    amountMinor = payment?.amount_captured ?? payment?.amount ?? order?.amount_paid;
    currency = payment?.currency || order?.currency;
    if (eventType === 'payment.captured' || eventType === 'order.paid' || payment?.status === 'captured') nextState = 'PAID';
  } else {
    const data = event.data || {};
    providerOrderId = data.order?.order_id || data.order_id;
    rawOrderId = providerOrderId;
    const payment = data.payment || {};
    amountMinor = Math.round(Number(payment.payment_amount ?? data.order?.order_amount ?? 0) * 100);
    currency = data.order?.order_currency || payment.payment_currency || 'INR';
    if (payment.payment_status === 'SUCCESS') nextState = 'PAID';
  }

  if (!nextState || !providerOrderId) {
    await persistEvent(account, eventId, eventType, raw);
    return res.status(200).json({ received: true, ignored: true });
  }
  const local = await findLocalOrder(account.id, providerOrderId, rawOrderId);
  if (!local) {
    await persistEvent(account, eventId, eventType, raw);
    return res.status(200).json({ received: true, unmatched: true });
  }
  if (nextState === 'PAID') {
    await markPaidFromProvider({ orderId: local.id, provider, providerAccountId: account.id, amountMinor, currency: currency || local.currency, source: 'webhook' });
  } else {
    await applyOrderState(local.id, nextState, `${provider}:webhook`);
  }
  await persistEvent(account, eventId, eventType, raw);
  return res.status(200).json({ received: true });
}

