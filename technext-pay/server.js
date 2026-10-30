import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 3000);
const merchantName = process.env.MERCHANT_NAME || 'TechNext Demo Store';
const merchantUpiId = process.env.MERCHANT_UPI_ID || 'merchant@example';
const orders = new Map();

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error('Request body too large');
  }
  return JSON.parse(raw || '{}');
}

function createUpiUri(order) {
  const params = new URLSearchParams({
    pa: merchantUpiId,
    pn: merchantName,
    am: order.amount.toFixed(2),
    cu: 'INR',
    tn: `Order ${order.id}`,
    tr: order.id
  });
  return `upi://pay?${params}`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, { merchantName, upiConfigured: merchantUpiId !== 'merchant@example', demoMode: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const body = await readJson(req);
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 1 || amount > 100_000) return json(res, 400, { error: 'Enter an amount from ₹1 to ₹100,000.' });
      const order = { id: `TN${Date.now().toString(36).toUpperCase()}`, amount: Math.round(amount * 100) / 100, status: 'PENDING', createdAt: new Date().toISOString() };
      order.upiUri = createUpiUri(order);
      order.qr = await QRCode.toDataURL(order.upiUri, { width: 280, margin: 1, color: { dark: '#111827', light: '#FFFFFF' } });
      orders.set(order.id, order);
      return json(res, 201, { id: order.id, amount: order.amount, status: order.status, upiUri: order.upiUri, qr: order.qr });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/orders/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/orders/'.length));
      const order = orders.get(id);
      return order ? json(res, 200, { id, amount: order.amount, status: order.status }) : json(res, 404, { error: 'Order not found. Demo orders are held in memory and expire when the server restarts.' });
    }
    if (req.method === 'GET') {
      const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const safePath = normalize(requested).replace(/^([.][.][/\\])+/, '');
      const file = join(publicDir, safePath);
      if (!file.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden' });
      try {
        const data = await readFile(file);
        const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
        return res.end(data);
      } catch { return json(res, 404, { error: 'Not found' }); }
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return json(res, error.message === 'Request body too large' ? 413 : 400, { error: 'Invalid request.' });
  }
});

server.listen(port, () => console.log(`TechNext Pay demo listening at http://localhost:${port}`));

