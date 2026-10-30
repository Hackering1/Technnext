# TechNext Pay

An original, self-hosted UPI checkout starter for TechNext. This repository is an independent implementation and does not copy YouPI-PG source code.

## Current scope

This first milestone is a **local demo**, not a payment gateway ready for production. It creates an order and a UPI payment URI/QR for a configured merchant VPA. Orders remain `PENDING`; the app does not read bank alerts, confirm settlement, handle refunds, or process real payment webhooks. Demo orders live in memory and disappear when the server restarts.

Do not use the demo status or a browser callback as proof that funds arrived. Real payment acceptance requires an appropriate merchant/bank/provider arrangement, secure server-side reconciliation, durable order storage, idempotent event handling, and a separate review of applicable requirements. This code makes no claim of bank, NPCI, or regulatory approval.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
copy .env.example .env
npm start
```

Open <http://localhost:3000>. Set `MERCHANT_UPI_ID` and `MERCHANT_NAME` in `.env` to configure the demo payment request. Use a test account and do not expose credentials.

## API

- `GET /api/config` — basic demo configuration
- `POST /api/orders` with `{"amount": 499}` — create a pending order and QR
- `GET /api/orders/:id` — read its current demo status

## Roadmap

1. Choose an authorized payment provider/acquirer and confirm merchant onboarding requirements.
2. Add a sandbox adapter for provider-hosted checkout and signed webhooks.
3. Add durable storage, reconciliation, refunds, audit trails, abuse controls, and operational monitoring.
4. Complete independent security, reliability, and compliance reviews before any live use.

## Attribution

The idea was prompted by the public YouPI-PG project. Its repository currently does not include a license granting reuse, so this codebase is implemented independently. TechNext Pay is not affiliated with YouPI-PG, Razorpay, Cashfree, NPCI, or any bank.

