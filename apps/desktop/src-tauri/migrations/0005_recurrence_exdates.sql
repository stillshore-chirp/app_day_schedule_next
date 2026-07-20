ALTER TABLE schedule_items ADD COLUMN recurrence_exdates_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(recurrence_exdates_json));

UPDATE app_meta
SET value = '5', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
