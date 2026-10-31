CREATE TABLE merchants (
  id UUID PRIMARY KEY,
  legal_name VARCHAR(200) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN ('REGISTERED','KYC_PENDING','KYC_VERIFIED','RISK_REVIEW','APPROVED','REJECTED','SUSPENDED','DEACTIVATED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE merchant_users (
  id UUID PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  public_key VARCHAR(80) NOT NULL UNIQUE,
  email VARCHAR(254) NOT NULL UNIQUE,
  phone VARCHAR(32) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role VARCHAR(32) NOT NULL CHECK (role IN ('MERCHANT_OWNER','MERCHANT_ADMIN','MERCHANT_OPERATOR','MERCHANT_VIEWER')),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_merchant_users_merchant ON merchant_users(merchant_id);

CREATE TABLE api_credentials (
  id UUID PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  secret_hash CHAR(64) NOT NULL UNIQUE,
  environment VARCHAR(12) NOT NULL CHECK(environment IN ('TEST','LIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX ix_api_credentials_merchant ON api_credentials(merchant_id);

CREATE TABLE payment_orders (
  id UUID PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  amount_minor BIGINT NOT NULL CHECK(amount_minor >= 100),
  currency CHAR(3) NOT NULL CHECK(currency = 'INR'),
  description VARCHAR(300) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK(status IN ('CREATED','INITIATED','AUTHORIZED','CAPTURED','FAILED','CANCELLED','PARTIALLY_REFUNDED','REFUNDED')),
  idempotency_key VARCHAR(100) NOT NULL,
  environment VARCHAR(12) NOT NULL CHECK(environment = 'TEST'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT uq_orders_merchant_idempotency UNIQUE(merchant_id,idempotency_key)
);
CREATE INDEX ix_payment_orders_merchant_created ON payment_orders(merchant_id,created_at DESC);

