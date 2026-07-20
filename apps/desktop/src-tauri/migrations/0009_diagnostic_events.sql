CREATE TABLE diagnostic_events (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 50),
  event TEXT NOT NULL CHECK (length(event) BETWEEN 1 AND 100),
  diagnostic_id TEXT,
  created_at_utc TEXT NOT NULL
);

CREATE INDEX diagnostic_events_time_idx ON diagnostic_events(created_at_utc DESC);

UPDATE app_meta
SET value = '9', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
