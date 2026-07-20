ALTER TABLE schedule_items ADD COLUMN start_notification_minutes INTEGER
  CHECK (start_notification_minutes IS NULL OR start_notification_minutes BETWEEN 0 AND 10080);
ALTER TABLE schedule_items ADD COLUMN end_notification_minutes INTEGER
  CHECK (end_notification_minutes IS NULL OR end_notification_minutes BETWEEN 0 AND 10080);

UPDATE settings
SET value_json = json_set(
  value_json,
  '$.scheduleNotificationsEnabled', COALESCE(json_extract(value_json, '$.scheduleNotificationsEnabled'), json('true')),
  '$.osNotificationsEnabled', COALESCE(json_extract(value_json, '$.osNotificationsEnabled'), json('true')),
  '$.soundNotificationsEnabled', COALESCE(json_extract(value_json, '$.soundNotificationsEnabled'), json('false')),
  '$.focusLongBreakMinutes', COALESCE(json_extract(value_json, '$.focusLongBreakMinutes'), 15),
  '$.focusLongBreakEvery', COALESCE(json_extract(value_json, '$.focusLongBreakEvery'), 4),
  '$.focusAutoStart', COALESCE(json_extract(value_json, '$.focusAutoStart'), json('false')),
  '$.focusNotificationsEnabled', COALESCE(json_extract(value_json, '$.focusNotificationsEnabled'), json('true'))
), updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'application';

UPDATE app_meta
SET value = '3', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
