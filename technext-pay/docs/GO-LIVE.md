# Go-live checklist

This checklist is not a compliance certification. The current code is a sandbox-capable foundation and should not be used for live transactions until these items are complete.

## Merchant and provider setup

- Confirm each product's legal merchant, contracting entity, merchant category, ownership, settlement bank account, refund policy, and provider eligibility.
- Get Razorpay/Cashfree approval for every merchant account and for any platform/partner model. Do not pool client receipts into a TechNext account.
- Confirm with Indian counsel whether the actual operating model stays within RBI's technology-only Payment Gateway definition or is Payment Aggregator activity requiring authorisation. The 2025 RBI direction distinguishes the roles and excludes PGs from the PA direction's scope; the real fund flow and contracts matter.
- Use sandbox keys first; enable live keys only after the provider has activated the merchant account.

## Platform and security

- Deploy behind HTTPS with a stable public webhook URL, WAF/reverse-proxy limits, database backups, Redis persistence/availability, alerting, and tested disaster recovery.
- Replace the environment-based encryption key with a managed KMS envelope-encryption flow before storing live provider credentials. Document key rotation, access policy, and break-glass procedures.
- Run dependency, source, threat-model, and penetration reviews. Restrict production secrets to the payment service; use least-privilege database roles and separate sandbox/live environments.
- Confirm data minimisation, retention/deletion, privacy notices, processor contracts, and applicable Indian data/storage requirements.
- Configure the outbox worker and each product's HTTPS event endpoint; alert on dead-lettered deliveries. Add refunds, dispute/chargeback handling, settlement reconciliation, customer support workflows, and an audit trail before live fulfilment.

## Sandbox acceptance

- Test success, failure, cancellation, delayed authorisation, duplicate event, invalid signature, amount/currency mismatch, webhook downtime/retry, and provider API timeout.
- Verify no fulfilment happens from client callbacks or the demo page.
- Verify order creation retries cannot create multiple charges; reconcile `CREATE_UNKNOWN` manually against the provider before retrying.
- Test key revocation/rotation and tenant isolation across HRMS, astrology, and client tenants.
- Record provider sandbox approval, reviewer, deployment revision, and rollback plan before enabling production credentials.
