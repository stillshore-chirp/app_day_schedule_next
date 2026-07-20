CREATE TABLE focus_history (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
  schedule_item_id TEXT REFERENCES schedule_items(id) ON DELETE SET NULL,
  event TEXT NOT NULL CHECK (event IN ('start', 'pause', 'resume', 'work_end', 'break_end', 'stop', 'skip')),
  from_phase TEXT CHECK (from_phase IN ('working', 'paused', 'break', 'waiting_next')),
  to_phase TEXT CHECK (to_phase IN ('working', 'paused', 'break', 'waiting_next')),
  elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
  occurred_at_utc TEXT NOT NULL
);

CREATE INDEX focus_history_time_idx ON focus_history(occurred_at_utc, event);
CREATE INDEX focus_history_schedule_idx ON focus_history(schedule_item_id, occurred_at_utc);

UPDATE app_meta
SET value = '8', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
