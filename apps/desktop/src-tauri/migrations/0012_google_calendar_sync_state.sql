ALTER TABLE google_calendars ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'never'
  CHECK (sync_state IN ('never', 'syncing', 'synced', 'retry_scheduled', 'auth_required', 'unavailable'));
ALTER TABLE google_calendars ADD COLUMN last_sync_attempt_at_utc TEXT;
ALTER TABLE google_calendars ADD COLUMN last_sync_completed_at_utc TEXT;
ALTER TABLE google_calendars ADD COLUMN next_retry_at_utc TEXT;
ALTER TABLE google_calendars ADD COLUMN last_error_category TEXT
  CHECK (
    last_error_category IS NULL
    OR last_error_category IN (
      'auth',
      'permission',
      'not_found',
      'rate_limited',
      'server',
      'network',
      'validation'
    )
  );

UPDATE google_calendars
SET
  sync_state = CASE WHEN sync_token IS NULL THEN 'never' ELSE 'synced' END,
  last_sync_completed_at_utc = CASE
    WHEN sync_token IS NULL THEN NULL
    ELSE (
      SELECT last_completed_at_utc
      FROM google_accounts
      WHERE google_accounts.id = google_calendars.account_id
    )
  END;

CREATE INDEX google_calendars_sync_state_idx
  ON google_calendars(selected, sync_state);

UPDATE app_meta
SET value = '12', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
