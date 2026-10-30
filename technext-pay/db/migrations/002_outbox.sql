ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webhook_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS encrypted_webhook_secret TEXT;

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  payment_order_id UUID NOT NULL REFERENCES payment_orders(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lock_until TIMESTAMPTZ,
  locked_by UUID,
  delivered_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  last_http_status INTEGER,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_order_id, event_type)
);
CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
  ON outbox_events(next_attempt_at, created_at)
  WHERE delivered_at IS NULL AND dead_lettered_at IS NULL;
