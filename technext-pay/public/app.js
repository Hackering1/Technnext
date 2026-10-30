const snippets = {
  cashfree: `const response = await fetch(
  \`${'${process.env.TECHNEXT_PAY_URL}'}/v1/orders\`,
  {
    method: 'POST',
    headers: {
      authorization: \`Bearer ${'${process.env.TECHNEXT_PAY_API_KEY}'}\`,
      'content-type': 'application/json',
      'idempotency-key': \`invoice-${'${invoice.id}'}\`
    },
    body: JSON.stringify({
      provider: 'cashfree',
      merchantOrderId: invoice.id,
      amountMinor: invoice.totalPaise,
      currency: 'INR',
      customer: { id: user.id, phone: user.phone },
      returnUrl: 'https://app.example.com/payments/return'
    })
  }
);
const order = await response.json();
// Launch the official Cashfree SDK with order.checkout.paymentSessionId.`,
  razorpay: `const response = await fetch(
  \`${'${process.env.TECHNEXT_PAY_URL}'}/v1/orders\`,
  {
    method: 'POST',
    headers: {
      authorization: \`Bearer ${'${process.env.TECHNEXT_PAY_API_KEY}'}\`,
      'content-type': 'application/json',
      'idempotency-key': \`invoice-${'${invoice.id}'}\`
    },
    body: JSON.stringify({
      provider: 'razorpay',
      merchantOrderId: invoice.id,
      amountMinor: invoice.totalPaise,
      currency: 'INR',
      customer: { id: user.id, phone: user.phone },
      returnUrl: 'https://app.example.com/payments/return'
    })
  }
);
const order = await response.json();
// Launch official Razorpay Checkout with order.checkout.orderId.`,
};

const snippet = document.querySelector('#code-snippet');
const tabs = document.querySelectorAll('.code-tab');
const copyButton = document.querySelector('#copy-code');
const toast = document.querySelector('#toast');
const status = document.querySelector('#api-status');
let toastTimer;

function showSnippet(provider) {
  snippet.textContent = snippets[provider];
  tabs.forEach((tab) => {
    const active = tab.dataset.provider === provider;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  });
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

tabs.forEach((tab) => tab.addEventListener('click', () => showSnippet(tab.dataset.provider)));
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(snippet.textContent);
    notify('Integration example copied');
  } catch {
    notify('Clipboard unavailable in this browser');
  }
});

async function updateApiStatus() {
  try {
    const response = await fetch('/health/ready', { cache: 'no-store' });
    if (!response.ok) throw new Error('API is not ready');
    status.classList.remove('down');
    status.classList.add('live');
    status.lastElementChild.textContent = 'API operational';
  } catch {
    status.classList.remove('live');
    status.classList.add('down');
    status.lastElementChild.textContent = 'API waking or unavailable';
  }
}

showSnippet('cashfree');
updateApiStatus();
setInterval(updateApiStatus, 30_000);
