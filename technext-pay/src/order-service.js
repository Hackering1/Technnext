import { createHash, randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { getProviderAccount, createProviderOrder, fetchProviderOrderStatus } from './providers.js';

async function enqueueClientEvent(client, order, status) {
  const eventType = `payment.${status.toLowerCase()}`;
  if (!order.webhook_url || !order.encrypted_webhook_secret) return;
  const eventId = randomUUID();
  const payload = {
    eventId,
    type: eventType,
    createdAt: new Date().toISOString(),
    data: {
      orderId: order.id,
      merchantOrderId: order.merchant_order_id,
      amountMinor: Number(order.amount_minor),
      currency: order.currency,
      status
    }
  };
  await client.query(
    `INSERT INTO outbox_events (id, tenant_id, payment_order_id, event_type, payload)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (payment_order_id, event_type) DO NOTHING`,
    [eventId, order.tenant_id, order.id, eventType, JSON.stringify(payload)]
  );
}

export async function createOrder({ tenant, provider, idempotencyKey, amountMinor, currency, customer, returnUrl, publicBaseUrl }) {
  const account = await getProviderAccount(tenant.id, provider);
  const id = randomUUID();
  let order;
  try {
    const result = await pool.query(
      `INSERT INTO payment_orders
        (id, tenant_id, provider_account_id, idempotency_key, merchant_order_id, amount_minor, currency, status, return_url_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'CREATING',$8)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [id, tenant.id, account.id, idempotencyKey, customer.orderRef, amountMinor, currency, createHash('sha256').update(returnUrl).digest('hex')]
    );
    order = result.rows[0];
    if (!order) {
      const existing = await pool.query('SELECT * FROM payment_orders WHERE tenant_id = $1 AND idempotency_key = $2', [tenant.id, idempotencyKey]);
      const prior = existing.rows[0];
      if (!prior) throw new Error('Idempotency conflict could not be resolved');
      const sameRequest = prior.provider_account_id === account.id &&
        prior.merchant_order_id === customer.orderRef &&
        Number(prior.amount_minor) === Number(amountMinor) &&
        prior.currency === currency &&
        prior.return_url_hash === createHash('sha256').update(returnUrl).digest('hex');
      if (!sameRequest) throw Object.assign(new Error('This Idempotency-Key was already used for a different order request'), { status: 409, code: 'idempotency_conflict' });
      if (['CREATING', 'CREATE_UNKNOWN', 'CREATE_FAILED'].includes(prior.status)) {
        return { conflict: true, order: prior };
      }
      return { reused: true, order: prior, checkout: prior.checkout_data };
    }
  } catch (error) { throw error; }

  try {
    const result = await createProviderOrder(account, order, returnUrl, tenant.slug, publicBaseUrl, customer);
    const saved = await pool.query(
      `UPDATE payment_orders SET provider_order_id = $2, checkout_data = $3, status = 'PENDING', updated_at = NOW()
       WHERE id = $1 RETURNING *`, [order.id, result.providerOrderId, JSON.stringify(result.checkout)]
    );
    return { reused: false, order: saved.rows[0], checkout: result.checkout };
  } catch (error) {
    const definitelyRejected = Number.isInteger(error.providerStatus) && error.providerStatus >= 400 && error.providerStatus < 500 && error.providerStatus !== 429;
    await pool.query(`UPDATE payment_orders SET status = $2, updated_at = NOW() WHERE id = $1`, [order.id, definitelyRejected ? 'CREATE_FAILED' : 'CREATE_UNKNOWN']);
    if (!definitelyRejected) error.code = 'provider_creation_unknown';
    throw error;
  }
}

export async function getOrderForTenant(tenant, orderId) {
  const result = await pool.query(
    `SELECT o.*, a.provider, a.environment, a.encrypted_credentials
     FROM payment_orders o JOIN provider_accounts a ON a.id = o.provider_account_id
     WHERE o.id = $1 AND o.tenant_id = $2`, [orderId, tenant.id]
  );
  const order = result.rows[0];
  if (!order) return null;
  if (order.status === 'PENDING' && order.provider_order_id && Date.now() - new Date(order.last_reconciled_at || 0).getTime() > 15_000) {
    try {
      const account = await getProviderAccount(tenant.id, order.provider);
      const state = await fetchProviderOrderStatus(account, order.provider_order_id);
      await applyOrderState(order.id, state, 'status_poll');
      await pool.query('UPDATE payment_orders SET last_reconciled_at = NOW() WHERE id = $1', [order.id]);
      order.status = state === 'PAID' ? 'PAID' : state;
    } catch { /* A provider outage must not erase the last known payment state. */ }
  }
  return order;
}

export async function applyOrderState(orderId, nextState, source) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT o.id, o.tenant_id, o.merchant_order_id, o.status, o.amount_minor, o.currency,
              t.webhook_url, t.encrypted_webhook_secret
       FROM payment_orders o JOIN tenants t ON t.id = o.tenant_id WHERE o.id = $1 FOR UPDATE OF o`, [orderId]
    );
    const order = found.rows[0];
    if (!order) { await client.query('ROLLBACK'); return false; }
    if (order.status !== 'PAID' && ['PAID', 'FAILED', 'EXPIRED'].includes(nextState)) {
      await client.query(`UPDATE payment_orders SET status = $2, status_source = $3, updated_at = NOW() WHERE id = $1`, [orderId, nextState, source]);
      await client.query(
        `INSERT INTO payment_events (payment_order_id, event_type, source)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [orderId, `payment.${nextState.toLowerCase()}`, source]
      );
      await enqueueClientEvent(client, order, nextState);
    }
    await client.query('COMMIT');
    return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function markPaidFromProvider({ orderId, provider, providerAccountId, amountMinor, currency, source }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT o.id, o.tenant_id, o.merchant_order_id, o.status, o.amount_minor, o.currency,
              t.webhook_url, t.encrypted_webhook_secret
       FROM payment_orders o JOIN tenants t ON t.id = o.tenant_id
       WHERE o.id = $1 AND o.provider_account_id = $2 FOR UPDATE OF o`, [orderId, providerAccountId]
    );
    const order = found.rows[0];
    if (!order) { await client.query('ROLLBACK'); return false; }
    if (Number(order.amount_minor) !== Number(amountMinor) || order.currency !== currency) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error('Provider payment amount or currency does not match the TechNext order'), { code: 'payment_mismatch' });
    }
    if (order.status !== 'PAID') {
      await client.query(`UPDATE payment_orders SET status = 'PAID', status_source = $2, updated_at = NOW() WHERE id = $1`, [orderId, `${provider}:${source}`]);
      await client.query('INSERT INTO payment_events (payment_order_id, event_type, source) VALUES ($1,$2,$3)', [orderId, 'payment.paid', `${provider}:${source}`]);
      await enqueueClientEvent(client, order, 'PAID');
    }
    await client.query('COMMIT');
    return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
