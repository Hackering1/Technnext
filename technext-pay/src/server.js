import { randomUUID, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import Redis from 'ioredis';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { authenticateTenant } from './auth.js';
import { getProviderAccount, fetchRazorpayPayment } from './providers.js';
import { createOrder, getOrderForTenant, markPaidFromProvider } from './order-service.js';
import { handleProviderWebhook } from './webhooks.js';
import { hashApiKey, safeEqual } from './crypto.js';
import { createCheckoutToken, readCheckoutToken } from './checkout-token.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-checkout-token'] });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, enableReadyCheck: true });
const app = express();
const checkoutLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix: 'tnp:checkout:' })
});
const dashboardLoginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix: 'tnp:dashboard-login:' })
});
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(pinoHttp({ logger, genReqId: (req) => req.get('x-request-id') || randomUUID(), redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-checkout-token'] }));
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", 'https://checkout.razorpay.com', 'https://sdk.cashfree.com', 'https://*.razorpay.com', 'https://*.cashfree.com'],
      connectSrc: ["'self'", 'https://*.razorpay.com', 'https://*.cashfree.com'],
      frameSrc: ["'self'", 'https://*.razorpay.com', 'https://*.cashfree.com'],
      formAction: ["'self'", 'https://*.razorpay.com', 'https://*.cashfree.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  }
}));
app.use(cors({ origin(origin, callback) {
  if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
  return callback(Object.assign(new Error('Origin is not allowed'), { status: 403, code: 'origin_not_allowed' }));
}, methods: ['GET', 'POST'], allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id', 'X-Checkout-Token'] }));
app.use((req, res, next) => {
  if (config.NODE_ENV === 'production' && !req.secure && !req.path.startsWith('/health/')) return res.status(400).json({ error: 'https_required' });
  return next();
});

const webhookRaw = express.raw({ type: 'application/json', limit: '1mb' });
for (const provider of ['razorpay', 'cashfree']) {
  app.post(`/webhooks/${provider}/:tenantSlug`, webhookRaw, async (req, res, next) => {
    try { await handleProviderWebhook(provider, req.params.tenantSlug, req, res); }
    catch (error) { next(error); }
  });
}
app.use(express.json({ limit: '64kb', strict: true }));

app.get('/health/live', (_req, res) => res.status(200).json({ status: 'ok' }));
app.get('/health/ready', async (_req, res, next) => {
  try { await pool.query('SELECT 1'); await redis.ping(); res.status(200).json({ status: 'ready' }); }
  catch (error) { next(error); }
});

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args) })
});
app.use('/v1', apiLimiter, authenticateTenant);

const orderInput = z.object({
  provider: z.enum(['razorpay', 'cashfree']),
  merchantOrderId: z.string().min(1).max(100),
  amountMinor: z.number().int().min(100).max(50_000_000),
  currency: z.literal('INR').default('INR'),
    customer: z.object({ id: z.string().min(1).max(100), phone: z.string().regex(/^\+?[0-9]{8,15}$/), email: z.string().email().optional() }),
  returnUrl: z.string().url()
});

function validateReturnUrl(value, returnHosts) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !returnHosts.map((host) => host.toLowerCase()).includes(url.hostname.toLowerCase())) {
    throw Object.assign(new Error('returnUrl must be HTTPS and use a host registered for this tenant'), { status: 400, code: 'invalid_return_url' });
  }
  return url.toString();
}

function requireCheckoutToken(req, res, next) {
  const orderId = readCheckoutToken(req.get('x-checkout-token'));
  if (!orderId) return res.status(401).json({ error: 'checkout_link_invalid_or_expired' });
  req.checkoutOrderId = orderId;
  return next();
}

function dashboardSessionSignature(tenantId, apiKeyId, expiresAt) {
  return createHmac('sha256', config.API_KEY_PEPPER)
    .update(`technext-dashboard:${tenantId}:${apiKeyId}:${expiresAt}`)
    .digest('base64url');
}

function requireDashboardSession(req, res, next) {
  const cookie = (req.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('tnp_session='));
  const token = cookie?.slice('tnp_session='.length);
  const parts = token?.split('.');
  if (!parts || parts.length !== 4) return res.status(401).json({ error: 'dashboard_session_required' });
  const [tenantId, apiKeyId, expiresText, signature] = parts;
  const expiresAt = Number(expiresText);
  if (!z.string().uuid().safeParse(tenantId).success || !z.string().uuid().safeParse(apiKeyId).success || !Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000) || !safeEqual(dashboardSessionSignature(tenantId, apiKeyId, expiresAt), signature)) {
    return res.status(401).json({ error: 'dashboard_session_expired' });
  }
  pool.query(
    `SELECT t.id, t.slug, t.name FROM tenants t JOIN api_keys k ON k.tenant_id = t.id
     WHERE t.id = $1 AND k.id = $2 AND k.revoked_at IS NULL AND t.active = TRUE`, [tenantId, apiKeyId]
  ).then((result) => {
    if (!result.rows[0]) return res.status(401).json({ error: 'dashboard_session_revoked' });
    req.tenant = result.rows[0];
    return next();
  }).catch(next);
}

app.post('/dashboard/api/session', dashboardLoginLimiter, async (req, res, next) => {
  try {
    const parsed = z.object({ apiKey: z.string().regex(/^tnp_live_[a-f0-9-]{36}\.[A-Za-z0-9_-]{40,}$/) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_api_key' });
    const apiKey = parsed.data.apiKey;
    const apiKeyId = apiKey.slice('tnp_live_'.length).split('.')[0];
    const result = await pool.query(
      `SELECT t.id AS tenant_id, t.name, k.id AS api_key_id, k.key_hash
       FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
       WHERE k.id = $1 AND k.revoked_at IS NULL AND t.active = TRUE`, [apiKeyId]
    );
    const row = result.rows[0];
    if (!row || !safeEqual(hashApiKey(apiKey), row.key_hash, 'hex')) return res.status(401).json({ error: 'invalid_api_key' });
    const expiresAt = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
    const signature = dashboardSessionSignature(row.tenant_id, row.api_key_id, expiresAt);
    const sessionToken = `${row.tenant_id}.${row.api_key_id}.${expiresAt}.${signature}`;
    const secure = config.NODE_ENV === 'production' ? '; Secure' : '';
    res.set('Set-Cookie', `tnp_session=${sessionToken}; Path=/; Max-Age=28800; HttpOnly; SameSite=Strict${secure}`);
    res.set('Cache-Control', 'no-store');
    return res.json({ merchantName: row.name, expiresAt });
  } catch (error) { return next(error); }
});

app.delete('/dashboard/api/session', (_req, res) => {
  const secure = config.NODE_ENV === 'production' ? '; Secure' : '';
  res.set('Set-Cookie', `tnp_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`);
  return res.status(204).end();
});

app.get('/dashboard/api/session', requireDashboardSession, (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({ merchantName: req.tenant.name });
});

app.get('/dashboard/api/summary', requireDashboardSession, async (req, res, next) => {
  try {
    const [summary, providers, daily] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total_orders,
                COUNT(*) FILTER (WHERE status = 'PAID')::int AS paid_orders,
                COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_orders,
                COUNT(*) FILTER (WHERE status IN ('FAILED','EXPIRED','CREATE_FAILED'))::int AS failed_orders,
                COALESCE(SUM(amount_minor) FILTER (WHERE status = 'PAID'), 0)::bigint AS paid_amount_minor
         FROM payment_orders WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`, [req.tenant.id]
      ),
      pool.query('SELECT provider, environment FROM provider_accounts WHERE tenant_id = $1 AND active = TRUE ORDER BY provider', [req.tenant.id]),
      pool.query(
        `SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day,
                COALESCE(SUM(amount_minor) FILTER (WHERE status = 'PAID'), 0)::bigint AS paid_amount_minor,
                COUNT(*) FILTER (WHERE status = 'PAID')::int AS paid_orders
         FROM payment_orders WHERE tenant_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '13 days'
         GROUP BY DATE_TRUNC('day', created_at) ORDER BY DATE_TRUNC('day', created_at)`, [req.tenant.id]
      )
    ]);
    res.set('Cache-Control', 'no-store');
    return res.json({ ...summary.rows[0], paid_amount_minor: Number(summary.rows[0].paid_amount_minor), providers: providers.rows, daily: daily.rows.map((row) => ({ ...row, paid_amount_minor: Number(row.paid_amount_minor) })) });
  } catch (error) { return next(error); }
});

app.get('/dashboard/api/orders', requireDashboardSession, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const result = await pool.query(
      `SELECT o.id, o.merchant_order_id, o.amount_minor, o.currency, o.status, o.created_at, a.provider,
              CASE WHEN o.idempotency_key LIKE 'dashboard-%' THEN 'Payment link' ELSE 'API' END AS source
       FROM payment_orders o JOIN provider_accounts a ON a.id = o.provider_account_id
       WHERE o.tenant_id = $1 ORDER BY o.created_at DESC LIMIT $2`, [req.tenant.id, limit]
    );
    res.set('Cache-Control', 'no-store');
    return res.json({ orders: result.rows.map((row) => ({ ...row, amount_minor: Number(row.amount_minor) })) });
  } catch (error) { return next(error); }
});

app.post('/dashboard/api/payment-links', requireDashboardSession, async (req, res, next) => {
  try {
    const parsed = z.object({
      provider: z.enum(['razorpay', 'cashfree']),
      merchantOrderId: z.string().min(1).max(100),
      amountMinor: z.number().int().min(100).max(50_000_000),
      customer: z.object({ id: z.string().min(1).max(100), phone: z.string().regex(/^\+?[0-9]{8,15}$/), email: z.string().email().optional() })
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })) });
    const returnUrl = `${config.FRONTEND_BASE_URL.replace(/\/$/, '')}/dashboard.html?payment=return`;
    const result = await createOrder({
      tenant: req.tenant,
      provider: parsed.data.provider,
      idempotencyKey: `dashboard-${randomUUID()}`,
      amountMinor: parsed.data.amountMinor,
      currency: 'INR',
      customer: { ...parsed.data.customer, orderRef: parsed.data.merchantOrderId },
      returnUrl,
      publicBaseUrl: config.PUBLIC_BASE_URL.replace(/\/$/, ''),
      frontendBaseUrl: config.FRONTEND_BASE_URL
    });
    if (result.conflict) return res.status(409).json({ error: 'order_creation_in_progress', orderId: result.order.id });
    return res.status(201).json({ orderId: result.order.id, status: result.order.status, amountMinor: Number(result.order.amount_minor), currency: result.order.currency, checkoutUrl: `${config.FRONTEND_BASE_URL.replace(/\/$/, '')}/checkout.html#${createCheckoutToken(result.order.id)}` });
  } catch (error) { return next(error); }
});

async function confirmRazorpayPayment(orderId, tenantId, paymentFields) {
  const orderResult = await pool.query(
    `SELECT o.*, a.provider FROM payment_orders o JOIN provider_accounts a ON a.id = o.provider_account_id
     WHERE o.id = $1 AND o.tenant_id = $2`, [orderId, tenantId]
  );
  const order = orderResult.rows[0];
  if (!order || order.provider !== 'razorpay' || order.provider_order_id !== paymentFields.razorpay_order_id) {
    throw Object.assign(new Error('Order not found'), { status: 404, code: 'order_not_found' });
  }
  const account = await getProviderAccount(tenantId, 'razorpay');
  const expected = createHmac('sha256', account.credentials.keySecret)
    .update(`${paymentFields.razorpay_order_id}|${paymentFields.razorpay_payment_id}`).digest('hex');
  if (!safeEqual(expected, paymentFields.razorpay_signature, 'hex')) {
    throw Object.assign(new Error('Payment signature is invalid'), { status: 400, code: 'invalid_payment_signature' });
  }
  const payment = await fetchRazorpayPayment(account, paymentFields.razorpay_payment_id);
  if (payment.order_id !== order.provider_order_id || payment.status !== 'captured' || Number(payment.amount) !== Number(order.amount_minor) || payment.currency !== order.currency) {
    throw Object.assign(new Error('Payment is not captured or does not match this order'), { status: 409, code: 'payment_not_captured_or_mismatch' });
  }
  await markPaidFromProvider({ orderId: order.id, provider: 'razorpay', providerAccountId: order.provider_account_id, amountMinor: payment.amount, currency: payment.currency, source: 'checkout_confirmation' });
  return { orderId: order.id, status: 'PAID' };
}

app.get('/public/checkout', checkoutLimiter, requireCheckoutToken, async (req, res, next) => {
  try {
    const found = await pool.query(
      `SELECT o.id, o.tenant_id, o.merchant_order_id, o.amount_minor, o.currency, o.status,
              o.checkout_data, o.return_url, a.provider, a.environment, t.name AS merchant_name
       FROM payment_orders o
       JOIN provider_accounts a ON a.id = o.provider_account_id
       JOIN tenants t ON t.id = o.tenant_id
       WHERE o.id = $1 AND t.active = TRUE`, [req.checkoutOrderId]
    );
    if (!found.rows[0]) return res.status(404).json({ error: 'order_not_found' });
    const row = found.rows[0];
    const current = row.status === 'PENDING'
      ? await getOrderForTenant({ id: row.tenant_id }, row.id)
      : row;
    res.set('Cache-Control', 'no-store');
    return res.json({
      orderId: row.id,
      merchantOrderId: row.merchant_order_id,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      status: current?.status || row.status,
      provider: row.provider,
      environment: row.environment,
      merchantName: row.merchant_name,
      checkout: row.checkout_data,
      returnUrl: row.return_url
    });
  } catch (error) { return next(error); }
});

app.post('/public/checkout/confirm', checkoutLimiter, requireCheckoutToken, async (req, res, next) => {
  try {
    const parsed = z.object({
      razorpay_order_id: z.string().min(1),
      razorpay_payment_id: z.string().min(1),
      razorpay_signature: z.string().min(1)
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request' });
    const found = await pool.query('SELECT tenant_id FROM payment_orders WHERE id = $1', [req.checkoutOrderId]);
    if (!found.rows[0]) return res.status(404).json({ error: 'order_not_found' });
    return res.json(await confirmRazorpayPayment(req.checkoutOrderId, found.rows[0].tenant_id, parsed.data));
  } catch (error) { return next(error); }
});

app.post('/v1/orders', async (req, res, next) => {
  try {
    const parsed = orderInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })) });
    const idempotencyKey = req.get('idempotency-key');
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) return res.status(400).json({ error: 'Idempotency-Key header is required (8-128 characters).' });
    const tenantResult = await pool.query('SELECT return_hosts FROM tenants WHERE id = $1', [req.tenant.id]);
    const returnUrl = validateReturnUrl(parsed.data.returnUrl, tenantResult.rows[0]?.return_hosts || []);
    const result = await createOrder({
      tenant: req.tenant,
      provider: parsed.data.provider,
      idempotencyKey,
      amountMinor: parsed.data.amountMinor,
      currency: parsed.data.currency,
      customer: { ...parsed.data.customer, orderRef: parsed.data.merchantOrderId },
      returnUrl,
      publicBaseUrl: config.PUBLIC_BASE_URL.replace(/\/$/, ''),
      frontendBaseUrl: config.FRONTEND_BASE_URL
    });
    if (result.conflict) return res.status(409).json({ error: 'order_creation_in_progress', orderId: result.order.id, status: result.order.status });
    return res.status(result.reused ? 200 : 201).json({
      orderId: result.order.id,
      merchantOrderId: result.order.merchant_order_id,
      amountMinor: Number(result.order.amount_minor),
      currency: result.order.currency,
      provider: parsed.data.provider,
      status: result.order.status,
      checkout: result.checkout,
      checkoutUrl: `${config.FRONTEND_BASE_URL.replace(/\/$/, '')}/checkout.html#${createCheckoutToken(result.order.id)}`
    });
  } catch (error) { next(error); }
});

app.post('/v1/orders/:id/confirm', async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(404).json({ error: 'order_not_found' });
    const body = z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid_request' });
    return res.json(await confirmRazorpayPayment(req.params.id, req.tenant.id, body.data));
  } catch (error) { next(error); }
});

app.get('/v1/orders/:id', async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(404).json({ error: 'order_not_found' });
    const order = await getOrderForTenant(req.tenant, req.params.id);
    if (!order) return res.status(404).json({ error: 'order_not_found' });
    return res.json({ orderId: order.id, merchantOrderId: order.merchant_order_id, amountMinor: Number(order.amount_minor), currency: order.currency, provider: order.provider, status: order.status, createdAt: order.created_at });
  } catch (error) { next(error); }
});

app.use(express.static(publicDir, { index: 'index.html', maxAge: '5m' }));

app.use((error, req, res, _next) => {
  const status = Number.isInteger(error.status) ? error.status : error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
  req.log?.error({ err: error, code: error.code, status }, 'request failed');
  if (res.headersSent) return;
  const code = status === 500 ? 'internal_error' : error.code || 'request_failed';
  return res.status(status).json({ error: code, message: status < 500 ? error.message : 'The request could not be completed.' });
});

const server = app.listen(config.PORT, () => logger.info({ port: config.PORT, env: config.NODE_ENV }, 'TechNext Pay API started'));
async function shutdown(signal) {
  logger.info({ signal }, 'shutdown started');
  server.close(async () => {
    await Promise.allSettled([pool.end(), redis.quit()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

