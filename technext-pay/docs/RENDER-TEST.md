# Free Render test deployment

The repository includes a Render Blueprint at its root (`render.yaml`). Open Render's Blueprint flow, connect `Hackering1/Technnext`, and deploy the Blueprint. It provisions a free web service, PostgreSQL database, and private Redis-compatible Key Value service. The Blueprint generates the encryption and API-key pepper secrets inside Render; they are not stored in Git.

The web container applies database migrations and starts the API plus outbox worker. Once the deploy is healthy, use the service URL shown in Render as `PUBLIC_BASE_URL`. Health endpoints are `/health/live` and `/health/ready`.

## Limits

This is for sandbox testing only. Render's free web service can sleep after 15 minutes without traffic and may take about a minute to wake. Free Postgres expires after 30 days and has no backups; free Key Value is in-memory and can lose data on restart. Do not use this deployment for live customers or real payment fulfilment. See [Render's free instance limits](https://render.com/docs/free).

## Enable a provider sandbox tenant

After the service is healthy, set the provider's sandbox environment variables in Render's service environment (never in Git):

- `TENANT_NAME`, `TENANT_SLUG`, `TENANT_PROVIDER`, `TENANT_ENVIRONMENT=test`, and `TENANT_RETURN_HOSTS`.
- For Razorpay, use sandbox `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`.
- For Cashfree, use sandbox `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_WEBHOOK_SECRET`, and `CASHFREE_API_VERSION`.

Run `npm run tenant:provision` from a protected operator environment connected to the Render database, using the generated `API_KEY_PEPPER` and `DATA_ENCRYPTION_KEY` values from Render. Store the resulting tenant API key in the calling product's server-side secret manager. Configure the provider sandbox webhook URL as `<service-url>/webhooks/<provider>/<tenant-slug>` and use the provider's sandbox test flows.

This hosted plan is intentionally ephemeral. Export anything needed before the free database expires. Upgrade to durable, backed-up services and complete the [go-live checklist](GO-LIVE.md) before any production use.
