CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  return_hosts TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  key_hash TEXT NOT NULL CHECK (length(key_hash) = 64),
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON api_keys(tenant_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS provider_accounts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  provider TEXT NOT NULL CHECK (provider IN ('razorpay', 'cashfree')),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  encrypted_credentials TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, provider)
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  provider_account_id UUID NOT NULL REFERENCES provider_accounts(id),
  idempotency_key TEXT NOT NULL,
  merchant_order_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CREATING','PENDING','PAID','FAILED','EXPIRED','CREATE_FAILED','CREATE_UNKNOWN')),
  provider_order_id TEXT,
  checkout_data JSONB,
  return_url_hash CHAR(64) NOT NULL,
  status_source TEXT,
  last_reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_id_idx ON payment_orders(provider_account_id, provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_orders_tenant_created_idx ON payment_orders(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider_account_id UUID NOT NULL REFERENCES provider_accounts(id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_account_id, event_id)
);

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  payment_order_id UUID NOT NULL REFERENCES payment_orders(id),
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_order_id, event_type)
);

