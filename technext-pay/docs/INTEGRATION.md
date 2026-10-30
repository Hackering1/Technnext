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
// Return only order.checkout to the product's own browser/app.
```

For Cashfree, pass `checkout.paymentSessionId` to the [official Cashfree JS SDK](https://www.cashfree.com/docs/payments/online/web/checkout). For Razorpay, pass `checkout.keyId` and `checkout.orderId` to [Razorpay Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/checkout-form/). Use the provider's current native SDK for mobile apps; do not build a custom card form.

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

## Webhook setup

Configure provider webhooks to TechNext Pay's tenant URL in the README. TechNext Pay persists provider event identifiers and updates order status. Provider keys and webhook secrets remain server-side. Use sandbox webhooks first and verify captured/paid, failed, duplicate, delayed, and out-of-order events before connecting fulfilment.

## Product-specific notes

- **HRMS:** tie orders to immutable invoice IDs; do not mark salary, payroll, statutory deductions, or employee claims paid based only on a client redirect.
- **Astrology apps:** define the purchased service and refund/cancellation rules before charging; grant access only after verified `PAID` status.
- **Client products:** issue one tenant key and separate provider merchant configuration per client/legal merchant. Confirm direct onboarding or a provider-approved platform arrangement with the provider before accepting client funds.

