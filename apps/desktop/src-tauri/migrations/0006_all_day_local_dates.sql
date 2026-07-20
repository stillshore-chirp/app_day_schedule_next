ALTER TABLE schedule_items ADD COLUMN all_day_start_date TEXT
  CHECK (all_day_start_date IS NULL OR length(all_day_start_date) = 10);

ALTER TABLE schedule_items ADD COLUMN all_day_end_date_exclusive TEXT
  CHECK (all_day_end_date_exclusive IS NULL OR length(all_day_end_date_exclusive) = 10);

UPDATE schedule_items
SET all_day_start_date = substr(start_at_utc, 1, 10),
    all_day_end_date_exclusive = substr(end_at_utc, 1, 10)
WHERE all_day = 1;

UPDATE app_meta
SET value = '6', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
