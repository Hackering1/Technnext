import { pool } from './db.js';
import { unseal } from './crypto.js';

export async function getProviderAccount(tenantId, provider) {
  const result = await pool.query(
    `SELECT id, provider, environment, encrypted_credentials
     FROM provider_accounts WHERE tenant_id = $1 AND provider = $2 AND active = TRUE`, [tenantId, provider]
  );
  const account = result.rows[0];
  if (!account) throw Object.assign(new Error('No active provider account is configured'), { status: 409, code: 'provider_not_configured' });
  return { ...account, credentials: unseal(account.encrypted_credentials) };
}

async function requestJson(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Provider request failed with HTTP ${response.status}`);
    error.providerStatus = response.status;
    throw error;
  }
  return body;
}

export async function createProviderOrder(account, order, returnUrl, tenantSlug, publicBaseUrl, customer) {
  const c = account.credentials;
  if (account.provider === 'razorpay') {
    const basic = Buffer.from(`${c.keyId}:${c.keySecret}`).toString('base64');
    const body = await requestJson('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: order.amount_minor,
        currency: order.currency,
        receipt: order.id.replaceAll('-', '').slice(0, 32),
        partial_payment: false,
        notes: { technext_order_id: order.id, tenant: tenantSlug }
      })
    });
    return { providerOrderId: body.id, checkout: { keyId: c.keyId, orderId: body.id, amount: body.amount, currency: body.currency } };
  }

  if (account.provider === 'cashfree') {
    const host = account.environment === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
    const body = await requestJson(`${host}/pg/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-version': c.apiVersion,
        'x-client-id': c.clientId,
        'x-client-secret': c.clientSecret,
        'x-idempotency-key': order.id
      },
      body: JSON.stringify({
        order_id: order.id.replaceAll('-', ''),
        order_amount: Number(order.amount_minor) / 100,
        order_currency: order.currency,
        customer_details: { customer_id: customer.id, customer_phone: customer.phone, ...(customer.email ? { customer_email: customer.email } : {}) },
        order_meta: { return_url: returnUrl, notify_url: `${publicBaseUrl}/webhooks/cashfree/${tenantSlug}` },
        order_note: `TechNext Pay ${order.id}`
      })
    });
    return { providerOrderId: body.order_id, checkout: { paymentSessionId: body.payment_session_id, environment: account.environment === 'production' ? 'production' : 'sandbox' } };
  }
  throw Object.assign(new Error('Unsupported provider'), { status: 400, code: 'unsupported_provider' });
}

export async function fetchProviderOrderStatus(account, providerOrderId) {
  const c = account.credentials;
  if (account.provider === 'razorpay') {
    const auth = Buffer.from(`${c.keyId}:${c.keySecret}`).toString('base64');
    const body = await requestJson(`https://api.razorpay.com/v1/orders/${encodeURIComponent(providerOrderId)}`, { headers: { authorization: `Basic ${auth}` } });
    return body.status === 'paid' ? 'PAID' : 'PENDING';
  }
  const host = account.environment === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
  const body = await requestJson(`${host}/pg/orders/${encodeURIComponent(providerOrderId)}`, {
    headers: { 'x-api-version': c.apiVersion, 'x-client-id': c.clientId, 'x-client-secret': c.clientSecret }
  });
  if (body.order_status === 'PAID') return 'PAID';
  if (body.order_status === 'EXPIRED') return 'EXPIRED';
  return 'PENDING';
}

export async function fetchRazorpayPayment(account, paymentId) {
  const c = account.credentials;
  const auth = Buffer.from(`${c.keyId}:${c.keySecret}`).toString('base64');
  return requestJson(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { authorization: `Basic ${auth}` } });
}

