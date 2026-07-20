CREATE TABLE IF NOT EXISTS google_oauth_config (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 10 AND 500),
  auth_uri TEXT NOT NULL CHECK (length(auth_uri) BETWEEN 10 AND 1000),
  token_uri TEXT NOT NULL CHECK (length(token_uri) BETWEEN 10 AND 1000),
  configured_at_utc TEXT NOT NULL
);

ALTER TABLE google_accounts ADD COLUMN credential_key TEXT
  CHECK (credential_key IS NULL OR length(credential_key) BETWEEN 1 AND 200);
ALTER TABLE google_accounts ADD COLUMN last_completed_at_utc TEXT;
ALTER TABLE google_accounts ADD COLUMN next_retry_at_utc TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS google_accounts_single_active_idx
  ON google_accounts((1)) WHERE status IN ('connected', 'auth_required');

UPDATE app_meta
SET value = '4', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
