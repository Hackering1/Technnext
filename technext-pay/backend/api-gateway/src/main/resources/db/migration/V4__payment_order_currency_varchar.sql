-- PostgreSQL CHAR columns are reported as bpchar; the JPA String mapping is VARCHAR.
ALTER TABLE platform_payment_orders
  ALTER COLUMN currency TYPE VARCHAR(3)
  USING rtrim(currency)::VARCHAR(3);
