# Platform implementation roadmap

This repository is being built in gated phases. Sandbox code is not represented as a live payment gateway.

1. **Identity and sandbox foundation (started):** signup/login, merchant isolation, test credentials, INR orders, idempotency, controlled sandbox payment transitions, portal, local PostgreSQL/Redis/Kafka topology.
2. **Onboarding and access:** OTP delivery/verification, business profile, KYC/KYB documents, review states, team membership and role-based access, test/live credential lifecycle. Live keys stay unavailable until approval and provider setup.
3. **Payments and checkout:** hosted provider checkout, documented provider adapters, payment attempts, verified provider callbacks, idempotent event processing.
4. **Financial controls:** immutable double-entry ledger, configurable fee/tax rules, refund workflow, audit trail.
5. **Operations:** licensed settlement integration, reconciliation, reports, disputes and chargebacks.
6. **Orchestration:** provider health and deterministic routing policy after partner integrations exist.
7. **Risk:** transparent deterministic rules and human review; ML signals remain advisory.
8. **AI:** isolated Python/FastAPI service for explanations and recommendations over merchant-authorized data only.
9. **Production gate:** security review, regulatory and finance sign-off, operational monitoring, provider certification, load/failure testing, incident/recovery runbooks.

Any phase involving custody, pooling or settlement of funds needs the appropriate authorized partner and legal/regulatory approval. No software milestone alone makes TechNext an RBI-authorized Payment Aggregator.

