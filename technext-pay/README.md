# TechNext Pay

TechNext Pay is a multi-tenant **payment integration service** for TechNext products. It creates orders with a tenant's own approved Razorpay or Cashfree merchant account, returns provider checkout data, validates signed provider webhooks, and stores payment state in PostgreSQL.

It does not collect or settle money itself. Configure a separate provider merchant account for each legal merchant/tenant. Do not route client businesses through a single TechNext merchant account unless the provider has approved the exact partner/marketplace arrangement and the required regulatory setup is in place.

## Current implementation

- Server-side order creation for Razorpay and Cashfree.
- Tenant-scoped API keys; provider credentials encrypted at rest in PostgreSQL.
- Amounts accepted in integer minor units (paise) and orders protected by idempotency keys.
- Razorpay and Cashfree webhook signature verification using the original raw request body.
- Webhook deduplication, amount/currency matching, and monotonic paid status updates.
- Provider-side status reconciliation for pending orders.
- PostgreSQL persistence, Redis-backed request rate limiting, health checks, and graceful shutdown.
- Return URLs restricted to each tenant's configured HTTPS host list.

This is a **production foundation, not a production-certified payment system**. It has not been security reviewed or tested against your provider sandbox yet. Refunds, subscriptions/mandates, chargebacks, settlement reconciliation, merchant administration, client event delivery, audit exports, and operational dashboards are not implemented. Keep payment fulfilment disabled until the full lifecycle is tested and reviewed.

## Regulatory and merchant boundary

RBI's 2025 directions define a Payment Gateway as technology infrastructure that routes/processes payments without handling funds; Payment Aggregators aggregate customer payments and subsequently settle collected funds to merchants. TechNext Pay is designed only for the former model. If TechNext onboards merchants, receives/pools funds, or settles client proceeds, stop and obtain qualified Indian regulatory advice and the appropriate RBI/provider approvals before launching. Each product merchant must be contractually onboarded with its own provider account, or through an explicitly approved provider partner flow. [RBI Master Direction on Regulation of Payment Aggregators, 2025](https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12896)

## Local setup

Requires Node.js 20+, PostgreSQL 15+, and Redis 7+.

```sh
copy .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm start
```

The provider service listens on `PORT` (default `3000`). If TLS terminates at a trusted reverse proxy, set `TRUST_PROXY=true` so production HTTPS enforcement can read the forwarded scheme. For the earlier QR-only sandbox page, run `npm run start:demo`; that demo is intentionally separate from the production API and never confirms payment.

Create strong unique values for `API_KEY_PEPPER` and `DATA_ENCRYPTION_KEY` before provisioning tenants. `DATA_ENCRYPTION_KEY` must be a base64-encoded 32-byte key. Store all production secrets in a managed secret store; do not put them in GitHub, source control, client apps, or chat.

## Provision one merchant tenant

Provide the tenant settings and credentials through your deployment secret manager or a protected operator shell, then run `npm run tenant:provision`. Required values:

- `TENANT_NAME`, `TENANT_SLUG`, `TENANT_PROVIDER` (`razorpay` or `cashfree`), `TENANT_ENVIRONMENT` (`test` or `production`), `TENANT_RETURN_HOSTS` (comma-separated exact hostnames).
- Razorpay: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- Cashfree: `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_WEBHOOK_SECRET`, `CASHFREE_API_VERSION`.
- `DATABASE_URL`, `API_KEY_PEPPER`, `DATA_ENCRYPTION_KEY`.

The command prints a tenant API key once. Save it in that calling product's backend secret manager. Revoke keys by setting `api_keys.revoked_at`; provision a replacement key before revoking the old one during rotation.

## API

All `/v1` calls use `Authorization: Bearer <tenant-api-key>`.

### Create a provider order

`POST /v1/orders` with `Idempotency-Key: <stable unique value>`:

```json
{
  "provider": "razorpay",
  "merchantOrderId": "hrms-invoice-5821",
  "amountMinor": 129900,
  "currency": "INR",
  "customer": { "id": "employee-42", "phone": "+919876543210" },
  "returnUrl": "https://hrms.example.com/payments/return"
}
```

`amountMinor` is paise (₹1,299.00 is `129900`). Determine the payable amount in the calling product's trusted backend; never accept a browser-supplied amount as authoritative. Use an opaque `merchantOrderId` without personal information. The return URL hostname must be in that tenant's `TENANT_RETURN_HOSTS` allowlist.

Response includes the provider checkout fields: Razorpay `keyId` and `orderId`, or Cashfree `paymentSessionId` and environment. Pass these to the provider's official hosted checkout SDK. Never expose the tenant API key or provider secret to a browser or mobile app.

### Confirm and query

- `POST /v1/orders/:id/confirm` verifies Razorpay Checkout's signature and then fetches the payment from Razorpay before marking it paid.
- `GET /v1/orders/:id` returns the tenant's order status and reconciles an old pending order with the provider at most once per 15 seconds.
- Cashfree confirmation is based on its signed webhook or server-side order status, not the browser redirect.

### Webhooks

Register these public HTTPS URLs in each provider dashboard:

- `POST <PUBLIC_BASE_URL>/webhooks/razorpay/<TENANT_SLUG>`
- `POST <PUBLIC_BASE_URL>/webhooks/cashfree/<TENANT_SLUG>`

Subscribe to the payment captured/paid events. Keep the body raw through signature verification. This service acknowledges duplicate deliveries idempotently; the provider should retry non-2xx responses.

## Client product flow

1. HRMS, astrology app, or another product backend calculates the charge and calls TechNext Pay with its tenant key and an idempotency key.
2. The client UI launches the official Razorpay or Cashfree checkout using the returned checkout fields.
3. The product backend receives the provider webhook directly at TechNext Pay or checks `GET /v1/orders/:id` before fulfilling access, subscriptions, reports, or invoices.
4. Fulfilment is idempotent in the product database. A redirect or client-side callback alone never proves payment.

See [the integration guide](docs/INTEGRATION.md) and [the go-live checklist](docs/GO-LIVE.md).

