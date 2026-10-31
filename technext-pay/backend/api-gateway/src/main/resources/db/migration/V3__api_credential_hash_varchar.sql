-- Match the entity's String mapping on PostgreSQL. CHAR(64) reports bpchar
-- and fails Hibernate schema validation against VARCHAR(64).
ALTER TABLE api_credentials
  ALTER COLUMN secret_hash TYPE VARCHAR(64)
  USING rtrim(secret_hash)::VARCHAR(64);
