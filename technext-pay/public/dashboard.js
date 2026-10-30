const byId = (id) => document.getElementById(id);
const state = { orders: [], providers: [], view: 'overview' };
const sections = {
  overview: ['Overview', 'Your payment overview', 'A live view of your merchant account activity.'],
  transactions: ['Transactions', 'All transactions', 'Provider-confirmed order activity from your account.'],
  links: ['Payment links', 'Collect without integration', 'Create and share a secure checkout link.'],
  developers: ['API & webhooks', 'Build with TechNext Pay', 'Connect your product backend to payment operations.'],
  settings: ['Providers', 'Provider accounts', 'Manage your connected provider setup.']
};
const exampleCode = [
  "const response = await fetch('https://technext-pay-test.onrender.com/v1/orders', {",
  "  method: 'POST',",
  "  headers: {",
  "    authorization: `Bearer ${process.env.TECHNEXT_PAY_API_KEY}`,",
  "    'content-type': 'application/json',",
  "    'idempotency-key': `invoice-${invoice.id}`",
  "  },",
  "  body: JSON.stringify({",
  "    provider: 'cashfree', merchantOrderId: invoice.id,",
  "    amountMinor: invoice.totalPaise, currency: 'INR',",
  "    customer: { id: user.id, phone: user.phone },",
  "    returnUrl: 'https://your-app.example/payments/return'",
  "  })",
  "});",
  "const { checkoutUrl } = await response.json();"
].join('\n');
byId('api-example').textContent = exampleCode;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function money(minor, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2 }).format((Number(minor) || 0) / 100);
}
function date(value) {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (response.status === 401) throw Object.assign(new Error('session_required'), { status: 401 });
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function showLogin(message = '') {
  byId('login-view').hidden = false;
  byId('app-view').hidden = true;
  byId('login-error').textContent = message;
}
function showApp(name) {
  byId('login-view').hidden = true;
  byId('app-view').hidden = false;
  const initial = [...String(name || 'T').trim()][0]?.toUpperCase() || 'T';
  byId('tenant-name').textContent = name || 'Merchant';
  byId('tenant-avatar').textContent = initial;
  byId('profile-avatar').textContent = initial;
}
function statusPill(status) {
  const key = String(status || '').toLowerCase();
  const label = ({ paid: 'Paid', pending: 'Pending', failed: 'Failed', expired: 'Expired', creating: 'Creating', create_unknown: 'Checking', create_failed: 'Failed' })[key] || esc(status);
  return `<span class="status-pill status-${esc(key)}">${label}</span>`;
}
function rows(orders) {
  if (!orders.length) return '<div class="empty-state"><b>No transactions yet</b>New payments will appear here as real orders are created.</div>';
  return `<table class="transaction-table"><thead><tr><th>ORDER</th><th>DATE</th><th>METHOD</th><th class="hide-mobile">SOURCE</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody>${orders.map((order) => `<tr><td class="order-ref">${esc(order.merchant_order_id)}</td><td>${esc(date(order.created_at))}</td><td><span class="provider-cell"><i class="provider-mini">${order.provider === 'razorpay' ? 'R' : 'C'}</i>${order.provider === 'razorpay' ? 'Razorpay' : 'Cashfree'}</span></td><td class="hide-mobile">${esc(order.source || 'API')}</td><td>${esc(money(order.amount_minor, order.currency))}</td><td>${statusPill(order.status)}</td></tr>`).join('')}</tbody></table>`;
}
function providersMarkup(list) {
  if (!list.length) return '<div class="empty-state"><b>No active provider account</b>Ask the TechNext Pay operator to connect an approved merchant account.</div>';
  return list.map((provider) => `<div class="provider-row"><span class="provider-glyph ${esc(provider.provider)}">${provider.provider === 'razorpay' ? 'R' : 'C'}</span><div><b>${provider.provider === 'razorpay' ? 'Razorpay' : 'Cashfree'}</b><small>${esc(provider.environment)} account</small></div><span class="provider-state">CONNECTED</span></div>`).join('');
}
function chartMarkup(days) {
  if (!(days || []).some((item) => Number(item.paid_amount_minor) > 0)) return '<div class="chart-empty">Captured payment volume will appear after the first successful payment.</div>';
  const max = Math.max(1, ...days.map((item) => Number(item.paid_amount_minor)));
  return days.map((item, index) => {
    const amount = Number(item.paid_amount_minor);
    const height = amount ? Math.max(8, amount / max * 100) : 3;
    const label = new Intl.DateTimeFormat('en-IN', { day: '2-digit' }).format(new Date(`${item.day}T00:00:00`));
    return `<div class="chart-col" title="${esc(item.day)} · ${esc(money(amount))}"><div class="chart-bar-wrap"><div class="chart-bar ${index === days.length - 1 ? 'today' : ''}" style="height:${height}%"></div></div><span class="chart-day">${esc(label)}</span></div>`;
  }).join('');
}
function redrawTables() {
  byId('recent-orders').innerHTML = rows(state.orders.slice(0, 6));
  byId('all-orders').innerHTML = rows(state.orders);
  byId('link-orders').innerHTML = rows(state.orders.filter((order) => order.source === 'Payment link'));
  byId('provider-summary').innerHTML = providersMarkup(state.providers);
  byId('provider-settings').innerHTML = providersMarkup(state.providers);
  byId('link-provider').innerHTML = state.providers.length
    ? state.providers.map((provider) => `<option value="${esc(provider.provider)}">${provider.provider === 'razorpay' ? 'Razorpay' : 'Cashfree'} · ${esc(provider.environment)}</option>`).join('')
    : '<option value="">No provider connected</option>';
}
async function refreshDashboard() {
  const [summary, orders] = await Promise.all([api('/dashboard/api/summary'), api('/dashboard/api/orders?limit=100')]);
  state.orders = orders.orders;
  state.providers = summary.providers;
  const activeProviders = state.providers;
  const isLive = activeProviders.some((provider) => provider.environment === 'production');
  const isTest = activeProviders.some((provider) => provider.environment !== 'production');
  byId('environment-title').textContent = isLive ? 'Production provider connected' : isTest ? 'Sandbox environment' : 'Provider not configured';
  byId('environment-detail').textContent = isLive
    ? 'Payments are processed by your connected provider account and subject to its fees and settlement rules.'
    : isTest
      ? 'Test credentials are active. No real money is being moved.'
      : 'Connect an approved Razorpay or Cashfree merchant account to accept payments.';
  byId('metric-volume').textContent = money(summary.paid_amount_minor);
  byId('metric-paid').textContent = new Intl.NumberFormat('en-IN').format(summary.paid_orders);
  byId('metric-pending').textContent = new Intl.NumberFormat('en-IN').format(summary.pending_orders);
  byId('metric-failed').textContent = new Intl.NumberFormat('en-IN').format(summary.failed_orders);
  byId('volume-chart').innerHTML = chartMarkup(summary.daily);
  redrawTables();
}
function switchView(view) {
  if (!sections[view]) return;
  state.view = view;
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.view-section').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  byId('current-section').textContent = sections[view][0];
  byId('page-title').textContent = sections[view][1];
  byId('page-subtitle').textContent = sections[view][2];
  if (view === 'transactions') filterTransactions();
}
function filterTransactions() {
  const status = byId('transaction-filter').value;
  const filtered = state.orders.filter((order) => status === 'all' || (status === 'FAILED' ? ['FAILED', 'EXPIRED', 'CREATE_FAILED'].includes(order.status) : order.status === status));
  byId('all-orders').innerHTML = rows(filtered);
}
function openDialog() {
  if (!state.providers.length) { switchView('settings'); return; }
  byId('link-form').hidden = false;
  byId('link-result').hidden = true;
  byId('link-error').textContent = '';
  byId('link-dialog').showModal();
}
document.querySelectorAll('.nav-item[data-view], [data-view-link]').forEach((item) => item.addEventListener('click', () => switchView(item.dataset.view || item.dataset.viewLink)));
document.querySelectorAll('.create-link-open').forEach((button) => button.addEventListener('click', openDialog));
byId('refresh-button').addEventListener('click', async () => {
  byId('refresh-button').textContent = '…';
  try { await refreshDashboard(); } catch { showLogin('Your session ended. Sign in again to continue.'); }
  byId('refresh-button').textContent = '↻';
});
byId('transaction-filter').addEventListener('change', filterTransactions);
byId('close-dialog').addEventListener('click', () => byId('link-dialog').close());
byId('done-link').addEventListener('click', () => { byId('link-dialog').close(); refreshDashboard().catch(() => {}); });
byId('copy-created-link').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(byId('created-link').value); byId('copy-created-link').textContent = 'Copied'; }
  catch { byId('link-error').textContent = 'Copy failed. Select and copy the link manually.'; }
});
byId('logout-button').addEventListener('click', async () => { await api('/dashboard/api/session', { method: 'DELETE' }).catch(() => {}); showLogin(); });
byId('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = byId('api-key');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  byId('login-error').textContent = '';
  try {
    const result = await api('/dashboard/api/session', { method: 'POST', body: JSON.stringify({ apiKey: input.value }) });
    input.value = '';
    showApp(result.merchantName);
    await refreshDashboard();
  } catch { byId('login-error').textContent = 'That key was not accepted. Check the tenant key and try again.'; }
  finally { button.disabled = false; }
});
byId('link-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  byId('link-error').textContent = '';
  try {
    const result = await api('/dashboard/api/payment-links', {
      method: 'POST',
      body: JSON.stringify({
        provider: data.get('provider'),
        merchantOrderId: data.get('merchantOrderId').trim(),
        amountMinor: Math.round(Number(data.get('amount')) * 100),
        customer: { id: data.get('phone').trim(), phone: data.get('phone').trim() }
      })
    });
    byId('created-link').value = result.checkoutUrl;
    byId('link-form').hidden = true;
    byId('link-result').hidden = false;
  } catch (error) {
    byId('link-error').textContent = error.message === 'provider_not_configured' ? 'This provider is not set up for this account yet.' : 'Could not create the link. Check the fields and provider setup.';
  } finally { submit.disabled = false; }
});
async function init() {
  try {
    const session = await api('/dashboard/api/session');
    showApp(session.merchantName);
    await refreshDashboard();
  } catch { showLogin(); }
}
init();
window.setInterval(() => {
  if (!document.hidden && !byId('app-view').hidden) refreshDashboard().catch(() => {});
}, 15000);

