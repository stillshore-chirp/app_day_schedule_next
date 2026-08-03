CREATE TABLE ticket_schedule_links (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  schedule_id TEXT NOT NULL REFERENCES schedule_items(id) ON DELETE RESTRICT,
  linked_at_utc TEXT NOT NULL,
  unlinked_at_utc TEXT,
  source TEXT NOT NULL CHECK (source IN ('board', 'today_drawer', 'schedule_editor', 'import')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  CHECK (unlinked_at_utc IS NULL OR unlinked_at_utc >= linked_at_utc)
);

CREATE UNIQUE INDEX ticket_schedule_links_active_schedule_idx
  ON ticket_schedule_links(schedule_id)
  WHERE unlinked_at_utc IS NULL;

CREATE INDEX ticket_schedule_links_active_ticket_idx
  ON ticket_schedule_links(ticket_id, schedule_id)
  WHERE unlinked_at_utc IS NULL;

CREATE INDEX ticket_schedule_links_schedule_history_idx
  ON ticket_schedule_links(schedule_id, linked_at_utc DESC, id);

CREATE TABLE ticket_schedule_link_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE,
  link_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('link', 'unlink', 'relink', 'archive_unlink', 'delete_unlink', 'schedule_delete_unlink')),
  before_json TEXT,
  after_json TEXT,
  created_at_utc TEXT NOT NULL
);

CREATE INDEX ticket_schedule_link_history_ticket_idx
  ON ticket_schedule_link_history(ticket_id, id DESC);

CREATE INDEX ticket_schedule_link_history_schedule_idx
  ON ticket_schedule_link_history(schedule_id, id DESC);

UPDATE app_meta
SET value = '15', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
