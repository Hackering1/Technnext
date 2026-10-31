# TechNext Pay

**Intelligent Payments. Powered by TechNext AI.**

TechNext Pay is an India-first payment technology platform foundation. The new platform milestone provides merchant signup/login, isolated merchant workspaces, one-time sandbox API credentials, idempotent INR order creation, a controlled sandbox payment state machine, and an initial React merchant portal. The sandbox cannot move real funds.

## Regulatory boundary

This repository does not represent TechNext as an RBI-authorized Payment Aggregator and does not pool or settle customer funds. A technology gateway can route payment instructions without handling funds; payment aggregation and settlement require the applicable authorization and licensed relationships. Real payment methods must use documented, approved bank/acquirer/provider integrations. No fake UPI/card rails are implemented. Each production merchant needs an approved provider arrangement. Obtain qualified Indian regulatory, security, finance and tax review before offering regulated services.

## Local development

Requirements: Docker Compose v2. The compose stack starts PostgreSQL, Redis, single-node Kafka, the Spring Boot API, and the React merchant portal.

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Open the merchant portal at `http://localhost:8088` and API health at `http://localhost:8080/actuator/health`. On signup, a `REGISTERED` merchant receives a test public key and a test secret key shown once. Keep the secret in a private server-side environment variable. Test-mode order creation is available before KYC approval; live access is not.

Run backend tests with Java 17+ and Maven:

```powershell
mvn -f backend/pom.xml test
```

The Java and Docker toolchains were unavailable in the initial build environment, so this project has not yet been compiled or container-started there. Do not use this milestone for live transactions.

## Initial API

- `POST /api/v1/auth/signup` — create a merchant workspace and test key (returned once).
- `POST /api/v1/auth/login` — obtain a short-lived portal JWT.
- `POST /api/v1/orders` — create an INR sandbox order. Use a portal JWT or test API secret in `Authorization: Bearer ...`, plus a stable `X-Idempotency-Key`. `amount` is an integer number of paise.
- `GET /api/v1/orders` and `GET /api/v1/orders/{id}` — list/query orders scoped to the authenticated merchant.
- `POST /api/v1/orders/{id}/sandbox-result?outcome=SUCCESS` — simulate a test outcome. Supported outcomes include `SUCCESS`, `FAILED`, `TIMEOUT`, `DECLINED`, `AUTHORIZED`, `CAPTURED`, `REFUND`, `PARTIAL_REFUND`, and `WEBHOOK_FAILURE`. This route only accepts TEST credentials.

## Repository map

- `backend/api-gateway`: Spring Boot API foundation, identity, merchant and sandbox order domains.
- `frontend/merchant-portal`: React/TypeScript test merchant workspace.
- `ai/`, `sdk/`, `infrastructure/`, `docs/`: platform expansion areas; not all services are implemented yet.
- `src/`, `public/`, `db/`: preserved earlier Node.js provider-connector prototype. It is separate from the new Spring/React platform and is not evidence that the new platform has provider integrations.

## Build status

Implemented in this milestone: signup/login, password hashing, test API key hashing, merchant isolation, idempotency constraints/serialization, INR minor-unit order storage, sandbox outcomes, payment state machine, initial merchant UI, PostgreSQL migrations, and local compose topology.

Not implemented yet: OTP delivery/verification, full KYC/KYB and document review, team RBAC management, production keys, licensed provider adapters, hosted checkout/provider tokenization, real webhooks, ledger, fees/tax, refunds, settlements, reconciliation, disputes, risk, fraud, AI, SDKs, admin portal, and production operations/security review. Live payments remain disabled.

