-- The API credential entity exposes a public test key as well as the hashed secret.
-- Backfill deterministically so this remains safe if an existing sandbox has credentials.
ALTER TABLE api_credentials ADD COLUMN public_key VARCHAR(80);
UPDATE api_credentials
SET public_key = 'tn_test_pub_' || replace(id::text, '-', '')
WHERE public_key IS NULL;
ALTER TABLE api_credentials ALTER COLUMN public_key SET NOT NULL;
ALTER TABLE api_credentials ADD CONSTRAINT uq_api_credentials_public_key UNIQUE (public_key);
