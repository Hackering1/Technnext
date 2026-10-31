# Phase 1 architecture: merchant identity and sandbox orders

## Trust boundaries

- The React portal talks to the same-origin API through Nginx.
- Portal sessions use a short-lived signed JWT. API credentials are generated as test-only secrets, hashed with SHA-256 at rest, and revealed once during signup.
- Each order query and sandbox action is scoped to the authenticated merchant ID. The database enforces a unique `(merchant_id, idempotency_key)` constraint.
- Sandbox results are explicit simulations. A TEST credential cannot invoke an acquiring integration because no live provider adapter exists in this phase.
- Signup leaves the merchant in `REGISTERED`. No user or merchant is automatically approved for live processing.

## Local topology

`merchant portal -> Nginx -> Spring Boot API -> PostgreSQL`

PostgreSQL migrations are applied by Flyway. Redis and single-node Kafka are present in Docker Compose for later rate-limit and event-pipeline work; the first milestone does not yet publish financial events to Kafka.

## Financial correctness notes

Amounts are integer paise. The browser converts rupee input using string parsing and integer arithmetic before sending the API request. Orders use optimistic versioning, and the order service serializes idempotent creation by taking a merchant row lock before checking/inserting the idempotency key. Payment transitions are centralized in `PaymentStateMachine`.

This phase has no ledger or real payment lifecycle. Do not treat sandbox order status as evidence of a customer payment.

