CREATE TABLE google_tasks_config (
  singleton INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  polling_interval_seconds INTEGER NOT NULL DEFAULT 300 CHECK (polling_interval_seconds BETWEEN 60 AND 86400),
  full_reconcile_interval_days INTEGER NOT NULL DEFAULT 7 CHECK (full_reconcile_interval_days BETWEEN 1 AND 90),
  updated_at_utc TEXT NOT NULL
);

INSERT INTO google_tasks_config(singleton, enabled, polling_interval_seconds, full_reconcile_interval_days, updated_at_utc)
VALUES (1, 0, 300, 7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE google_task_lists (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  google_account_id TEXT NOT NULL REFERENCES google_accounts(id) ON DELETE CASCADE,
  remote_list_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 1024),
  remote_etag TEXT,
  selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
  default_write_target INTEGER NOT NULL DEFAULT 0 CHECK (default_write_target IN (0, 1)),
  sync_state TEXT NOT NULL DEFAULT 'never' CHECK (sync_state IN ('never', 'syncing', 'synced', 'offline', 'retry_scheduled', 'auth_required', 'conflict', 'unavailable')),
  incremental_watermark_utc TEXT,
  last_full_sync_at_utc TEXT,
  last_success_at_utc TEXT,
  last_error_category TEXT CHECK (last_error_category IS NULL OR last_error_category IN ('auth_required', 'scope_missing', 'forbidden', 'not_found', 'conflict', 'validation_required', 'unsupported', 'rate_limited', 'server', 'timeout', 'offline', 'malformed_remote')),
  next_retry_at_utc TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE(google_account_id, remote_list_id)
);

CREATE UNIQUE INDEX google_task_lists_default_write_idx
  ON google_task_lists(default_write_target)
  WHERE default_write_target = 1;
CREATE INDEX google_task_lists_sync_idx
  ON google_task_lists(selected, sync_state, next_retry_at_utc);

CREATE TABLE google_task_mappings (
  ticket_id TEXT PRIMARY KEY NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  google_task_list_id TEXT NOT NULL REFERENCES google_task_lists(id) ON DELETE CASCADE,
  remote_task_id TEXT NOT NULL,
  remote_etag TEXT,
  remote_updated_at_utc TEXT,
  base_snapshot_json TEXT NOT NULL,
  remote_parent_id TEXT,
  remote_position TEXT,
  remote_deleted INTEGER NOT NULL DEFAULT 0 CHECK (remote_deleted IN (0, 1)),
  last_pulled_at_utc TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE(google_task_list_id, remote_task_id)
);

CREATE INDEX google_task_mappings_list_idx
  ON google_task_mappings(google_task_list_id, remote_position, remote_task_id);

CREATE TABLE google_task_remote_shadows (
  google_task_list_id TEXT NOT NULL REFERENCES google_task_lists(id) ON DELETE CASCADE,
  remote_task_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  error_category TEXT NOT NULL CHECK (error_category IN ('malformed_remote', 'validation_required', 'unsupported')),
  captured_at_utc TEXT NOT NULL,
  PRIMARY KEY(google_task_list_id, remote_task_id)
);

CREATE TABLE google_task_outbox (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  operation_id TEXT NOT NULL CHECK (length(operation_id) = 36),
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('create', 'update', 'complete', 'reopen', 'move', 'delete', 'detach')),
  entity_version INTEGER NOT NULL CHECK (entity_version >= 0),
  target_list_id TEXT REFERENCES google_task_lists(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at_utc TEXT NOT NULL,
  last_error_category TEXT CHECK (last_error_category IS NULL OR last_error_category IN ('auth_required', 'scope_missing', 'forbidden', 'not_found', 'conflict', 'validation_required', 'unsupported', 'rate_limited', 'server', 'timeout', 'offline', 'malformed_remote', 'uncertain_create')),
  uncertain_create INTEGER NOT NULL DEFAULT 0 CHECK (uncertain_create IN (0, 1)),
  created_at_utc TEXT NOT NULL,
  completed_at_utc TEXT
);

CREATE INDEX google_task_outbox_due_idx
  ON google_task_outbox(completed_at_utc, uncertain_create, next_attempt_at_utc, created_at_utc);
CREATE INDEX google_task_outbox_ticket_idx
  ON google_task_outbox(ticket_id, completed_at_utc);

CREATE TABLE google_task_conflicts (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL CHECK (field_name IN ('title', 'notes', 'due', 'completed', 'parent', 'tasklist', 'delete')),
  base_value_json TEXT NOT NULL,
  local_value_json TEXT NOT NULL,
  remote_value_json TEXT NOT NULL,
  conflict_type TEXT NOT NULL CHECK (conflict_type IN ('same_field', 'remote_delete', 'local_delete', 'complete_column', 'parent_move', 'list_move', 'uncertain_create')),
  detected_at_utc TEXT NOT NULL,
  resolved_at_utc TEXT,
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('local', 'google', 'detach', 'delete_local'))
);

CREATE INDEX google_task_conflicts_open_idx
  ON google_task_conflicts(resolved_at_utc, detected_at_utc DESC, ticket_id);
CREATE UNIQUE INDEX google_task_conflicts_one_open_field_idx
  ON google_task_conflicts(ticket_id, field_name)
  WHERE resolved_at_utc IS NULL;

UPDATE app_meta
SET value = '17', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
