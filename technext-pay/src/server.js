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
import { safeEqual } from './crypto.js';
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
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(pinoHttp({ logger, genReqId: (req) => req.get('x-request-id') || randomUUID(), redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-checkout-token'] }));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
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

