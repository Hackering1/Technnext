const API_BASE_URL = 'https://technext-pay-test.onrender.com';
const token = window.location.hash.slice(1);
const notice = document.querySelector('#notice');
const payButton = document.querySelector('#pay-button');
const checkButton = document.querySelector('#check-button');
const returnLink = document.querySelector('#return-link');
let checkout;

function setNotice(message, kind = '') {
  notice.textContent = message;
  notice.className = `notice ${kind}`.trim();
}

async function requestCheckout(path, init = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'X-Checkout-Token': token,
      ...(init.headers || {})
    },
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Checkout service returned ${response.status}`);
  return data;
}

function showReturnLink() {
  if (!checkout?.returnUrl) return;
  const url = new URL(checkout.returnUrl);
  url.searchParams.set('technext_order_id', checkout.orderId);
  url.searchParams.set('merchant_order_id', checkout.merchantOrderId);
  url.searchParams.set('payment_status', checkout.status);
  returnLink.href = url.toString();
  returnLink.hidden = false;
}

function applyStatus(data) {
  checkout = { ...checkout, ...data };
  if (data.status === 'PAID') {
    setNotice('Payment verified. Your order is paid.', 'success');
    payButton.hidden = true;
    checkButton.hidden = true;
    showReturnLink();
  } else if (['FAILED', 'EXPIRED'].includes(data.status)) {
    setNotice(data.status === 'FAILED' ? 'The payment was not completed.' : 'This payment link has expired.', 'error');
    payButton.hidden = true;
    checkButton.hidden = false;
  } else {
    setNotice('Payment is pending. Complete it in the provider window, then check the status here.');
    checkButton.hidden = false;
  }
}

async function refreshStatus() {
  try {
    applyStatus(await requestCheckout('/public/checkout'));
  } catch (error) {
    setNotice(error.message === 'checkout_link_invalid_or_expired'
      ? 'This payment link has expired. Ask the merchant for a new link.'
      : 'Could not reach TechNext Pay. Please try again in a moment.', 'error');
  }
}

async function launchPayment() {
  if (!checkout) return;
  payButton.disabled = true;
  setNotice('Opening secure payment…');
  try {
    if (checkout.provider === 'razorpay') {
      if (!window.Razorpay) throw new Error('Razorpay Checkout did not load. Refresh and try again.');
      const razorpay = new window.Razorpay({
        key: checkout.checkout.keyId,
        amount: checkout.checkout.amount,
        currency: checkout.checkout.currency,
        order_id: checkout.checkout.orderId,
        name: checkout.merchantName,
        description: `Order ${checkout.merchantOrderId}`,
        theme: { color: '#9bce52' },
        handler: async (result) => {
          setNotice('Verifying your payment…');
          try {
            const verified = await requestCheckout('/public/checkout/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(result)
            });
            applyStatus(verified);
          } catch {
            setNotice('Payment submitted. We are checking the provider record; do not pay again.', 'success');
            checkButton.hidden = false;
          }
        },
        modal: { ondismiss: () => { payButton.disabled = false; setNotice('Checkout closed. You can try again when ready.'); } }
      });
      razorpay.on('payment.failed', () => {
        payButton.disabled = false;
        setNotice('The provider reported a failed payment. You may try again.', 'error');
      });
      razorpay.open();
      return;
    }

    if (checkout.provider === 'cashfree') {
      if (!window.Cashfree) throw new Error('Cashfree Checkout did not load. Refresh and try again.');
      const cashfree = window.Cashfree({ mode: checkout.environment === 'production' ? 'production' : 'sandbox' });
      await cashfree.checkout({ paymentSessionId: checkout.checkout.paymentSessionId, redirectTarget: '_self' });
      return;
    }
    throw new Error('This provider is not supported for checkout.');
  } catch (error) {
    payButton.disabled = false;
    setNotice(error.message || 'Could not start payment. Please retry.', 'error');
  }
}

async function init() {
  if (!token) {
    setNotice('This payment link is incomplete. Please ask the merchant for a new link.', 'error');
    return;
  }
  payButton.addEventListener('click', launchPayment);
  checkButton.addEventListener('click', refreshStatus);
  try {
    checkout = await requestCheckout('/public/checkout');
    document.querySelector('#merchant-name').textContent = checkout.merchantName;
    document.querySelector('#amount').textContent = new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: checkout.currency, minimumFractionDigits: 2
    }).format(checkout.amountMinor / 100);
    document.querySelector('#order-reference').textContent = `Order ${checkout.merchantOrderId}`;
    if (checkout.status === 'PAID') {
      applyStatus(checkout);
      return;
    }
    if (['FAILED', 'EXPIRED'].includes(checkout.status)) {
      applyStatus(checkout);
      return;
    }
    const providerName = checkout.provider === 'razorpay' ? 'Razorpay' : 'Cashfree';
    payButton.textContent = `Pay securely with ${providerName}`;
    payButton.disabled = false;
    setNotice(checkout.environment === 'production' ? 'You are paying the merchant through its payment provider.' : 'Sandbox mode · No real money will be charged.');
    if (new URLSearchParams(window.location.search).has('return')) checkButton.hidden = false;
  } catch {
    setNotice('This payment link is unavailable or expired. Ask the merchant for a new link.', 'error');
  }
}

init();

