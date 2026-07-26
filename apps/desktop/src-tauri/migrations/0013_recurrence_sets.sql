ALTER TABLE schedule_items
ADD COLUMN recurrence_supplemental_lines_json TEXT NOT NULL DEFAULT '[]'
  CHECK (
    json_valid(recurrence_supplemental_lines_json)
    AND json_type(recurrence_supplemental_lines_json) = 'array'
  );

UPDATE app_meta
SET value = '13', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
