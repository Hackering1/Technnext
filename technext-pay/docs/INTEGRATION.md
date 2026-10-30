# Client product integration

Each HRMS, astrology, or client application calls TechNext Pay from its **server**, with a separate tenant API key and a provider merchant account approved for that legal merchant. Never embed `tnp_live_...`, Razorpay key secrets, Cashfree client secrets, or webhook secrets in front-end code.

## Node backend: create the order

```js
const response = await fetch(`${process.env.TECHNEXT_PAY_URL}/v1/orders`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${process.env.TECHNEXT_PAY_API_KEY}`,
    'content-type': 'application/json',
    'idempotency-key': `invoice-${invoice.id}-attempt-${invoice.paymentAttempt}`
  },
  body: JSON.stringify({
    provider: 'cashfree', // choose the provider enabled for this tenant
    merchantOrderId: invoice.id,
    amountMinor: invoice.totalPaise, // calculate from trusted server-side data
    currency: 'INR',
    customer: { id: user.id, phone: user.phone },
    returnUrl: 'https://hrms.example.com/payments/return'
  })
});
if (!response.ok) throw new Error(`TechNext Pay returned ${response.status}`);
const order = await response.json();
// Return the hosted payment URL to the product browser.
return res.json({ checkoutUrl: order.checkoutUrl });
```

The customer sees the TechNext Pay checkout page, then completes the payment through the configured provider's official hosted flow. The page accepts UPI and any other methods enabled on that merchant's provider account. Provider secrets remain on the server, and card or UPI credentials never pass through TechNext Pay. Use the provider's native SDK for mobile apps.

After the provider redirects the customer to `returnUrl`, verify the order using the API or the signed payment webhook. The browser redirect is not proof of payment. The return page receives `technext_order_id`, `merchant_order_id`, and `payment_status` for display/navigation only.

## Confirm a Razorpay checkout

After Checkout returns its fields to the product backend, send them to TechNext Pay:

```js
await fetch(`${process.env.TECHNEXT_PAY_URL}/v1/orders/${orderId}/confirm`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${process.env.TECHNEXT_PAY_API_KEY}`,
    'content-type': 'application/json'
  },
  body: JSON.stringify({ razorpay_order_id, razorpay_payment_id, razorpay_signature })
});
```

The service verifies the checkout signature and fetches the payment from Razorpay before returning `PAID`. The product must still match the returned `merchantOrderId`, amount, and currency against its own invoice before granting access.

## Status and fulfilment

`GET /v1/orders/:id` is tenant-scoped. Treat `PENDING` as unpaid. Make fulfilment idempotent with a unique payment/order constraint in the product database; webhook and status updates can be repeated or arrive after a browser redirect. Define a recovery path for provider timeouts and `CREATE_UNKNOWN` order creation: reconcile with the provider before retrying a charge.

## Signed TechNext Pay events

Set `TENANT_WEBHOOK_URL` when provisioning a tenant and run `npm run worker:outbox` as a separate long-lived process. The endpoint must be HTTPS, and its hostname must be included in `TENANT_RETURN_HOSTS`. Provisioning prints a separate outbound signing secret once. Store it in the product backend secret manager.

TechNext Pay sends `payment.paid`, `payment.failed`, or `payment.expired` JSON events. Verify `X-TechNext-Signature` as lowercase hex HMAC-SHA256 using the secret over `<X-TechNext-Timestamp>.<exact raw request body>`. Reject stale timestamps (for example, more than five minutes old), compare signatures in constant time, and deduplicate using `X-TechNext-Event-Id` or `eventId` in the body. Persist the event ID and fulfil only after validating the order, amount, currency, and status against the product's own invoice. Return a 2xx only after durable acceptance. Retries may deliver an event more than once; non-2xx responses retry with backoff, up to 20 attempts, then the row is dead-lettered for operator review.

Example Node verification (mount raw-body parsing before JSON parsing on this route):

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyTechNextEvent(rawBody, timestamp, receivedHex, secret) {
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  const received = Buffer.from(receivedHex, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
```

## Webhook setup

Configure provider webhooks to TechNext Pay's tenant URL in the README. TechNext Pay persists provider event identifiers and updates order status. Provider keys and webhook secrets remain server-side. Use sandbox webhooks first and verify captured/paid, failed, duplicate, delayed, and out-of-order events before connecting fulfilment.

## Product-specific notes

- **HRMS:** tie orders to immutable invoice IDs; do not mark salary, payroll, statutory deductions, or employee claims paid based only on a client redirect.
- **Astrology apps:** define the purchased service and refund/cancellation rules before charging; grant access only after verified `PAID` status.
- **Client products:** issue one tenant key and separate provider merchant configuration per client/legal merchant. Confirm direct onboarding or a provider-approved platform arrangement with the provider before accepting client funds.

