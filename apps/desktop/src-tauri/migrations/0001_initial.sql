PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS window_states (
  window_label TEXT PRIMARY KEY NOT NULL,
  state_json TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 100),
  color TEXT NOT NULL CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 100),
  color TEXT NOT NULL CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 50),
  created_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_items (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  location TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 500),
  start_at_utc TEXT NOT NULL,
  end_at_utc TEXT NOT NULL,
  time_zone TEXT NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 100),
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('not_started', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  project TEXT NOT NULL DEFAULT '' CHECK (length(project) <= 100),
  category TEXT NOT NULL DEFAULT '' CHECK (length(category) <= 100),
  tags_json TEXT NOT NULL DEFAULT '[]',
  color TEXT NOT NULL CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  sync_status TEXT NOT NULL DEFAULT 'local_only' CHECK (sync_status IN ('local_only', 'pending', 'syncing', 'synced', 'offline', 'retry_scheduled', 'conflict', 'auth_required', 'read_only')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  deleted_at_utc TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  CHECK (julianday(end_at_utc) > julianday(start_at_utc))
);

CREATE INDEX IF NOT EXISTS schedule_items_range_idx ON schedule_items(start_at_utc, end_at_utc) WHERE deleted_at_utc IS NULL;
CREATE INDEX IF NOT EXISTS schedule_items_status_idx ON schedule_items(status, start_at_utc) WHERE deleted_at_utc IS NULL;
CREATE INDEX IF NOT EXISTS schedule_items_deleted_idx ON schedule_items(deleted_at_utc) WHERE deleted_at_utc IS NOT NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS schedule_items_fts USING fts5(
  title,
  description,
  location,
  project,
  category,
  tags,
  content='schedule_items',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS schedule_items_fts_insert AFTER INSERT ON schedule_items BEGIN
  INSERT INTO schedule_items_fts(rowid, title, description, location, project, category, tags)
  VALUES (new.rowid, new.title, new.description, new.location, new.project, new.category, new.tags_json);
END;
CREATE TRIGGER IF NOT EXISTS schedule_items_fts_delete AFTER DELETE ON schedule_items BEGIN
  INSERT INTO schedule_items_fts(schedule_items_fts, rowid, title, description, location, project, category, tags)
  VALUES ('delete', old.rowid, old.title, old.description, old.location, old.project, old.category, old.tags_json);
END;
CREATE TRIGGER IF NOT EXISTS schedule_items_fts_update AFTER UPDATE ON schedule_items BEGIN
  INSERT INTO schedule_items_fts(schedule_items_fts, rowid, title, description, location, project, category, tags)
  VALUES ('delete', old.rowid, old.title, old.description, old.location, old.project, old.category, old.tags_json);
  INSERT INTO schedule_items_fts(rowid, title, description, location, project, category, tags)
  VALUES (new.rowid, new.title, new.description, new.location, new.project, new.category, new.tags_json);
END;

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  color TEXT NOT NULL,
  weekdays_mask INTEGER NOT NULL DEFAULT 127 CHECK (weekdays_mask BETWEEN 0 AND 127),
  is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS templates_single_builtin_idx ON templates(is_builtin) WHERE is_builtin = 1;

CREATE TABLE IF NOT EXISTS template_blocks (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  color TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS template_blocks_template_idx ON template_blocks(template_id, start_minute);

CREATE TABLE IF NOT EXISTS quick_blocks (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  time_zone TEXT NOT NULL,
  color TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 0,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS free_alarms (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 200),
  minute_of_day INTEGER NOT NULL CHECK (minute_of_day BETWEEN 0 AND 1439),
  time_zone TEXT NOT NULL,
  weekdays_mask INTEGER NOT NULL DEFAULT 127 CHECK (weekdays_mask BETWEEN 0 AND 127),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('schedule', 'quick_block', 'free_alarm', 'focus')),
  entity_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('start', 'end', 'alarm', 'work_end', 'break_end')),
  offset_minutes INTEGER NOT NULL DEFAULT 0 CHECK (offset_minutes BETWEEN -10080 AND 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  UNIQUE(entity_type, entity_id, phase, offset_minutes)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  delivery_key TEXT PRIMARY KEY NOT NULL,
  rule_id TEXT NOT NULL REFERENCES notification_rules(id) ON DELETE CASCADE,
  occurrence_at_utc TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('delivered', 'skipped', 'failed', 'expired')),
  attempted_at_utc TEXT NOT NULL,
  error_category TEXT
);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  schedule_item_id TEXT REFERENCES schedule_items(id) ON DELETE SET NULL,
  phase TEXT NOT NULL CHECK (phase IN ('working', 'paused', 'break', 'waiting_next')),
  previous_phase TEXT CHECK (previous_phase IN ('working', 'break')),
  started_at_utc TEXT NOT NULL,
  ended_at_utc TEXT,
  accumulated_seconds INTEGER NOT NULL DEFAULT 0 CHECK (accumulated_seconds >= 0),
  cycle INTEGER NOT NULL DEFAULT 0 CHECK (cycle >= 0)
);

CREATE TABLE IF NOT EXISTS google_accounts (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  display_label TEXT NOT NULL DEFAULT 'Google account',
  scopes_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('connected', 'auth_required', 'disconnected')),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_calendars (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  account_id TEXT NOT NULL REFERENCES google_accounts(id) ON DELETE CASCADE,
  remote_calendar_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  color TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  access_role TEXT NOT NULL CHECK (access_role IN ('owner', 'writer', 'reader', 'freeBusyReader')),
  selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
  default_write_target INTEGER NOT NULL DEFAULT 0 CHECK (default_write_target IN (0, 1)),
  sync_token TEXT,
  UNIQUE(account_id, remote_calendar_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS google_calendars_default_write_idx ON google_calendars(default_write_target) WHERE default_write_target = 1;

CREATE TABLE IF NOT EXISTS sync_mappings (
  schedule_item_id TEXT NOT NULL REFERENCES schedule_items(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES google_calendars(id) ON DELETE CASCADE,
  remote_event_id TEXT NOT NULL,
  etag TEXT,
  remote_updated_at_utc TEXT,
  base_snapshot_json TEXT NOT NULL,
  base_hash TEXT NOT NULL,
  PRIMARY KEY(schedule_item_id, calendar_id),
  UNIQUE(calendar_id, remote_event_id)
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL CHECK (entity_version >= 0),
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at_utc TEXT NOT NULL,
  error_category TEXT,
  created_at_utc TEXT NOT NULL,
  completed_at_utc TEXT
);

CREATE INDEX IF NOT EXISTS sync_outbox_due_idx ON sync_outbox(completed_at_utc, next_attempt_at_utc);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  schedule_item_id TEXT NOT NULL REFERENCES schedule_items(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES google_calendars(id) ON DELETE CASCADE,
  base_json TEXT NOT NULL,
  local_json TEXT NOT NULL,
  remote_json TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unresolved', 'resolved', 'superseded')),
  created_at_utc TEXT NOT NULL,
  resolved_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS change_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id TEXT NOT NULL CHECK (length(action_id) = 36),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'bulk')),
  before_json TEXT,
  after_json TEXT,
  undone INTEGER NOT NULL DEFAULT 0 CHECK (undone IN (0, 1)),
  created_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS change_history_undo_idx ON change_history(undone, id DESC);

CREATE TABLE IF NOT EXISTS backup_history (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  relative_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  verified INTEGER NOT NULL CHECK (verified IN (0, 1)),
  created_at_utc TEXT NOT NULL
);

INSERT OR IGNORE INTO app_meta(key, value, updated_at_utc)
VALUES ('schema_version', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO settings(key, value_json, updated_at_utc)
VALUES (
  'application',
  '{"theme":"system","locale":"ja","snapMinutes":5,"closeBehavior":"tray","notificationGraceMinutes":10,"notificationMaxReplay":3,"focusWorkMinutes":25,"focusBreakMinutes":5}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT OR IGNORE INTO templates(
  id, name, description, color, weekdays_mask, is_builtin, sort_order, version, created_at_utc, updated_at_utc
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  '基本',
  '削除できない既定の一日のテンプレート',
  '#6F96F4',
  127,
  1,
  0,
  0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
