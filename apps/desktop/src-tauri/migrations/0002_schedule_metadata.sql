ALTER TABLE schedule_items ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE schedule_items ADD COLUMN recurrence_rule TEXT
  CHECK (recurrence_rule IS NULL OR length(recurrence_rule) BETWEEN 6 AND 500);
ALTER TABLE schedule_items ADD COLUMN recurrence_series_id TEXT
  CHECK (recurrence_series_id IS NULL OR length(recurrence_series_id) = 36);
ALTER TABLE schedule_items ADD COLUMN recurrence_original_start_utc TEXT;

CREATE INDEX IF NOT EXISTS schedule_items_priority_idx
  ON schedule_items(priority, start_at_utc) WHERE deleted_at_utc IS NULL;
CREATE INDEX IF NOT EXISTS schedule_items_recurrence_idx
  ON schedule_items(recurrence_series_id, recurrence_original_start_utc)
  WHERE recurrence_series_id IS NOT NULL;

UPDATE app_meta
SET value = '2', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
