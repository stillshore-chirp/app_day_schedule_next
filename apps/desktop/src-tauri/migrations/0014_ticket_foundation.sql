CREATE TABLE ticket_boards (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE ticket_columns (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  board_id TEXT NOT NULL REFERENCES ticket_boards(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('inbox', 'backlog', 'next', 'in_progress', 'waiting', 'done')),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE(board_id, kind),
  UNIQUE(board_id, sort_order)
);

CREATE INDEX ticket_columns_board_order_idx
  ON ticket_columns(board_id, sort_order, id);

CREATE TABLE tickets (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  board_id TEXT NOT NULL REFERENCES ticket_boards(id) ON DELETE RESTRICT,
  column_id TEXT NOT NULL REFERENCES ticket_columns(id) ON DELETE RESTRICT,
  last_non_done_column_id TEXT REFERENCES ticket_columns(id) ON DELETE RESTRICT,
  parent_ticket_id TEXT REFERENCES tickets(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 1024),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_date TEXT CHECK (due_date IS NULL OR (length(due_date) = 10 AND date(due_date) = due_date)),
  estimate_minutes INTEGER CHECK (estimate_minutes IS NULL OR estimate_minutes BETWEEN 1 AND 100800),
  sort_key INTEGER NOT NULL CHECK (sort_key > 0),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  completed_at_utc TEXT,
  archived_at_utc TEXT,
  deleted_at_utc TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  CHECK (parent_ticket_id IS NULL OR parent_ticket_id <> id)
);

CREATE INDEX tickets_board_column_order_idx
  ON tickets(board_id, column_id, sort_key, id)
  WHERE deleted_at_utc IS NULL;
CREATE INDEX tickets_parent_idx
  ON tickets(parent_ticket_id)
  WHERE parent_ticket_id IS NOT NULL AND deleted_at_utc IS NULL;
CREATE INDEX tickets_due_idx
  ON tickets(due_date, priority)
  WHERE deleted_at_utc IS NULL AND archived_at_utc IS NULL;
CREATE INDEX tickets_archived_idx
  ON tickets(archived_at_utc)
  WHERE archived_at_utc IS NOT NULL AND deleted_at_utc IS NULL;
CREATE INDEX tickets_deleted_idx
  ON tickets(deleted_at_utc)
  WHERE deleted_at_utc IS NOT NULL;

CREATE VIRTUAL TABLE tickets_fts USING fts5(
  title,
  description,
  content='tickets',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER tickets_fts_insert AFTER INSERT ON tickets BEGIN
  INSERT INTO tickets_fts(rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;
CREATE TRIGGER tickets_fts_delete AFTER DELETE ON tickets BEGIN
  INSERT INTO tickets_fts(tickets_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
END;
CREATE TRIGGER tickets_fts_update AFTER UPDATE ON tickets BEGIN
  INSERT INTO tickets_fts(tickets_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
  INSERT INTO tickets_fts(rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;

CREATE TABLE ticket_tags (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 50),
  normalized_name TEXT NOT NULL UNIQUE CHECK (length(normalized_name) BETWEEN 1 AND 200),
  created_at_utc TEXT NOT NULL
);

CREATE TABLE ticket_tag_links (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES ticket_tags(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 19),
  PRIMARY KEY(ticket_id, tag_id),
  UNIQUE(ticket_id, sort_order)
);

CREATE INDEX ticket_tag_links_tag_idx ON ticket_tag_links(tag_id, ticket_id);

CREATE TABLE ticket_checklist_items (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 199),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE(ticket_id, sort_order)
);

CREATE INDEX ticket_checklist_ticket_order_idx
  ON ticket_checklist_items(ticket_id, sort_order, id);

CREATE TABLE ticket_change_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id TEXT NOT NULL CHECK (length(action_id) = 36),
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'move', 'reorder', 'parent', 'complete', 'reopen', 'archive', 'restore', 'delete')),
  entity_version INTEGER NOT NULL CHECK (entity_version >= 0),
  before_json TEXT,
  after_json TEXT,
  created_at_utc TEXT NOT NULL
);

CREATE INDEX ticket_change_history_ticket_idx
  ON ticket_change_history(ticket_id, id DESC);
CREATE UNIQUE INDEX ticket_change_history_action_idx
  ON ticket_change_history(action_id, ticket_id, entity_version);

INSERT OR IGNORE INTO ticket_boards(id, name, version, created_at_utc, updated_at_utc)
VALUES (
  '00000000-0000-4000-8000-000000000100',
  'チケット',
  0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT OR IGNORE INTO ticket_columns(id, board_id, kind, name, sort_order, version, created_at_utc, updated_at_utc)
VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000100', 'inbox', 'Inbox', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000100', 'backlog', 'Backlog', 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000100', 'next', 'Next', 2, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000100', 'in_progress', 'In Progress', 3, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000100', 'waiting', 'Waiting', 4, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000100', 'done', 'Done', 5, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

UPDATE app_meta
SET value = '14', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
