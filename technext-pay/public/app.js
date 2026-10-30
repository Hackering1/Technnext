const form = document.querySelector('#pay-form');
const amountInput = document.querySelector('#amount');
const result = document.querySelector('#result');
document.querySelector('#year').textContent = new Date().getFullYear();

document.querySelectorAll('[data-amount]').forEach((button) => {
  button.addEventListener('click', () => { amountInput.value = button.dataset.amount; });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.querySelector('span:first-child').textContent = 'Creating request…';
  result.hidden = true;
  try {
    const response = await fetch('/api/orders', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: amountInput.value })
    });
    const order = await response.json();
    if (!response.ok) throw new Error(order.error || 'Could not create request.');
    result.innerHTML = `<span class="status">PAYMENT NOT VERIFIED</span><h3>UPI request created</h3><p>Scan using a UPI app. This demo cannot confirm settlement.</p><img src="${order.qr}" alt="UPI payment QR code"><div class="order-id">${order.id} · ₹${Number(order.amount).toFixed(2)}</div>`;
    result.hidden = false;
  } catch (error) {
    result.textContent = error.message;
    result.hidden = false;
  } finally {
    submit.disabled = false;
    submit.querySelector('span:first-child').textContent = 'Create UPI request';
  }
});

