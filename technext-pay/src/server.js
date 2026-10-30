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

const logger = pino({ level: process.env.LOG_LEVEL || 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, enableReadyCheck: true });
const app = express();
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(pinoHttp({ logger, genReqId: (req) => req.get('x-request-id') || randomUUID(), redact: ['req.headers.authorization', 'req.headers.cookie'] }));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({ origin(origin, callback) {
  if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
  return callback(Object.assign(new Error('Origin is not allowed'), { status: 403, code: 'origin_not_allowed' }));
}, methods: ['GET', 'POST'], allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'] }));
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
      publicBaseUrl: config.PUBLIC_BASE_URL.replace(/\/$/, '')
    });
    if (result.conflict) return res.status(409).json({ error: 'order_creation_in_progress', orderId: result.order.id, status: result.order.status });
    return res.status(result.reused ? 200 : 201).json({
      orderId: result.order.id,
      merchantOrderId: result.order.merchant_order_id,
      amountMinor: Number(result.order.amount_minor),
      currency: result.order.currency,
      provider: parsed.data.provider,
      status: result.order.status,
      checkout: result.checkout
    });
  } catch (error) { next(error); }
});

app.post('/v1/orders/:id/confirm', async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(404).json({ error: 'order_not_found' });
    const body = z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid_request' });
    const orderResult = await pool.query(
      `SELECT o.*, a.provider FROM payment_orders o JOIN provider_accounts a ON a.id = o.provider_account_id
       WHERE o.id = $1 AND o.tenant_id = $2`, [req.params.id, req.tenant.id]
    );
    const order = orderResult.rows[0];
    if (!order || order.provider !== 'razorpay' || order.provider_order_id !== body.data.razorpay_order_id) return res.status(404).json({ error: 'order_not_found' });
    const account = await getProviderAccount(req.tenant.id, 'razorpay');
    const expected = createHmac('sha256', account.credentials.keySecret).update(`${body.data.razorpay_order_id}|${body.data.razorpay_payment_id}`).digest('hex');
    if (!safeEqual(expected, body.data.razorpay_signature, 'hex')) return res.status(400).json({ error: 'invalid_payment_signature' });
    const payment = await fetchRazorpayPayment(account, body.data.razorpay_payment_id);
    if (payment.order_id !== order.provider_order_id || payment.status !== 'captured' || Number(payment.amount) !== Number(order.amount_minor) || payment.currency !== order.currency) {
      return res.status(409).json({ error: 'payment_not_captured_or_mismatch', status: order.status });
    }
    await markPaidFromProvider({ orderId: order.id, provider: 'razorpay', providerAccountId: order.provider_account_id, amountMinor: payment.amount, currency: payment.currency, source: 'checkout_confirmation' });
    return res.status(200).json({ orderId: order.id, status: 'PAID' });
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
