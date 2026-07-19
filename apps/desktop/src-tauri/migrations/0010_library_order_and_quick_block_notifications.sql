ALTER TABLE quick_blocks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quick_blocks ADD COLUMN start_notification_minutes INTEGER
  CHECK (start_notification_minutes IS NULL OR start_notification_minutes BETWEEN 0 AND 10080);
ALTER TABLE quick_blocks ADD COLUMN end_notification_minutes INTEGER
  CHECK (end_notification_minutes IS NULL OR end_notification_minutes BETWEEN 0 AND 10080);

UPDATE quick_blocks
SET sort_order = (
  SELECT COUNT(*)
  FROM quick_blocks AS preceding
  WHERE preceding.start_minute < quick_blocks.start_minute
     OR (preceding.start_minute = quick_blocks.start_minute AND preceding.id < quick_blocks.id)
);

CREATE INDEX quick_blocks_order_idx ON quick_blocks(sort_order, id);

UPDATE app_meta
SET value = '10', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
