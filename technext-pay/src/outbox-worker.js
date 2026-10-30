import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pool } from './db.js';
import { unseal } from './crypto.js';

const workerId = randomUUID();
const maxAttempts = 20;
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

async function claimBatch() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      `WITH candidates AS (
         SELECT id FROM outbox_events
         WHERE delivered_at IS NULL AND dead_lettered_at IS NULL
           AND next_attempt_at <= NOW() AND (lock_until IS NULL OR lock_until < NOW())
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10
       )
       UPDATE outbox_events e SET locked_by = $1, lock_until = NOW() + INTERVAL '2 minutes',
         delivery_attempts = e.delivery_attempts + 1
       FROM candidates c WHERE e.id = c.id RETURNING e.*`, [workerId]
    );
    const events = [];
    for (const event of claimed.rows) {
      const tenant = await client.query(
        'SELECT webhook_url, encrypted_webhook_secret FROM tenants WHERE id = $1', [event.tenant_id]
      );
      events.push({ ...event, ...tenant.rows[0] });
    }
    await client.query('COMMIT');
    return events;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function settle(event, { delivered = false, status = null, errorCode = null } = {}) {
  if (delivered) {
    await pool.query(
      `UPDATE outbox_events SET delivered_at = NOW(), last_http_status = $3,
        last_error_code = NULL, locked_by = NULL, lock_until = NULL
       WHERE id = $1 AND locked_by = $2`, [event.id, workerId, status]
    );
    return;
  }
  const terminal = event.delivery_attempts >= maxAttempts;
  const backoffSeconds = Math.min(3600, 2 ** Math.min(event.delivery_attempts, 11)) + Math.floor(Math.random() * 15);
  await pool.query(
    `UPDATE outbox_events SET last_http_status = $3, last_error_code = $4,
       next_attempt_at = NOW() + ($5 * INTERVAL '1 second'),
       dead_lettered_at = CASE WHEN $6 THEN NOW() ELSE NULL END,
       locked_by = NULL, lock_until = NULL
     WHERE id = $1 AND locked_by = $2`,
    [event.id, workerId, status, errorCode, backoffSeconds, terminal]
  );
}

async function deliver(event) {
  try {
    if (!event.webhook_url || !event.encrypted_webhook_secret) throw Object.assign(new Error('Webhook configuration missing'), { code: 'configuration_missing' });
    const target = new URL(event.webhook_url);
    if (target.protocol !== 'https:' || target.username || target.password) throw Object.assign(new Error('Webhook URL rejected'), { code: 'invalid_webhook_url' });
    const body = typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const secret = unseal(event.encrypted_webhook_secret);
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const response = await fetch(target, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
      headers: {
        'content-type': 'application/json',
        'x-technext-timestamp': timestamp,
        'x-technext-signature': signature,
        'x-technext-event-id': event.id
      },
      body
    });
    if (response.status >= 200 && response.status < 300) {
      await settle(event, { delivered: true, status: response.status });
    } else {
      await settle(event, { status: response.status, errorCode: response.status >= 300 && response.status < 400 ? 'redirect_rejected' : 'endpoint_non_2xx' });
    }
  } catch (error) {
    await settle(event, { errorCode: error.name === 'TimeoutError' ? 'timeout' : (error.code || 'network_error') });
  }
}

try {
  while (!stopping) {
    try {
      const events = await claimBatch();
      if (events.length) await Promise.all(events.map(deliver));
      else await delay(1_000);
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'outbox_worker_error', message: error.message }));
      await delay(2_000);
    }
  }
} finally {
  await pool.end();
}
