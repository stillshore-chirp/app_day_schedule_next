CREATE TABLE timers (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 100),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 1 AND 604800),
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'paused', 'completed')),
  started_at_utc TEXT,
  elapsed_before_start_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_before_start_seconds >= 0),
  run_id TEXT CHECK (run_id IS NULL OR length(run_id) = 36),
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  CHECK (
    (status = 'running' AND started_at_utc IS NOT NULL AND run_id IS NOT NULL)
    OR (status <> 'running' AND started_at_utc IS NULL)
  )
);

CREATE INDEX timers_order_idx ON timers(sort_order, created_at_utc, id);

CREATE TABLE timer_sets (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(name)) BETWEEN 1 AND 100),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE timer_set_items (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  timer_set_id TEXT NOT NULL REFERENCES timer_sets(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 100),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 1 AND 604800),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(timer_set_id, sort_order)
);

CREATE INDEX timer_set_items_set_idx ON timer_set_items(timer_set_id, sort_order, id);

CREATE TABLE stopwatch_state (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
  status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'paused')),
  started_at_utc TEXT,
  elapsed_before_start_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_before_start_seconds >= 0),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at_utc TEXT NOT NULL,
  CHECK (
    (status = 'running' AND started_at_utc IS NOT NULL)
    OR (status <> 'running' AND started_at_utc IS NULL)
  )
);

INSERT INTO stopwatch_state(
  singleton_id, status, started_at_utc, elapsed_before_start_seconds, version, updated_at_utc
) VALUES (
  1, 'idle', NULL, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE TABLE timer_run_completions (
  run_id TEXT PRIMARY KEY NOT NULL CHECK (length(run_id) = 36),
  timer_id TEXT NOT NULL REFERENCES timers(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 100),
  completed_at_utc TEXT NOT NULL
);

CREATE INDEX timer_run_completions_time_idx
ON timer_run_completions(completed_at_utc, run_id);

CREATE TABLE notification_rules_v11 (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('schedule', 'quick_block', 'free_alarm', 'focus', 'timer')),
  entity_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('start', 'end', 'alarm', 'work_end', 'break_end', 'complete')),
  offset_minutes INTEGER NOT NULL DEFAULT 0 CHECK (offset_minutes BETWEEN -10080 AND 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  UNIQUE(entity_type, entity_id, phase, offset_minutes)
);

INSERT INTO notification_rules_v11(
  id, entity_type, entity_id, phase, offset_minutes, enabled
)
SELECT id, entity_type, entity_id, phase, offset_minutes, enabled
FROM notification_rules;

CREATE TABLE notification_deliveries_v11 (
  delivery_key TEXT PRIMARY KEY NOT NULL,
  rule_id TEXT NOT NULL REFERENCES notification_rules_v11(id) ON DELETE CASCADE,
  occurrence_at_utc TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('delivered', 'skipped', 'failed', 'expired')),
  attempted_at_utc TEXT NOT NULL,
  error_category TEXT
);

INSERT INTO notification_deliveries_v11(
  delivery_key, rule_id, occurrence_at_utc, result, attempted_at_utc, error_category
)
SELECT delivery_key, rule_id, occurrence_at_utc, result, attempted_at_utc, error_category
FROM notification_deliveries;

DROP TABLE notification_deliveries;
DROP TABLE notification_rules;
ALTER TABLE notification_rules_v11 RENAME TO notification_rules;
ALTER TABLE notification_deliveries_v11 RENAME TO notification_deliveries;

UPDATE app_meta
SET value = '11', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
