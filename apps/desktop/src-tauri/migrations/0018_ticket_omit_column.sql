CREATE TABLE ticket_columns_v18 (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  board_id TEXT NOT NULL REFERENCES ticket_boards(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('inbox', 'backlog', 'next', 'in_progress', 'waiting', 'done', 'omit')),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE(board_id, kind),
  UNIQUE(board_id, sort_order)
);

INSERT INTO ticket_columns_v18(
  id,
  board_id,
  kind,
  name,
  sort_order,
  version,
  created_at_utc,
  updated_at_utc
)
SELECT
  id,
  board_id,
  kind,
  name,
  sort_order,
  version,
  created_at_utc,
  updated_at_utc
FROM ticket_columns;

DROP INDEX ticket_columns_board_order_idx;
DROP TABLE ticket_columns;
ALTER TABLE ticket_columns_v18 RENAME TO ticket_columns;

CREATE INDEX ticket_columns_board_order_idx
  ON ticket_columns(board_id, sort_order, id);

INSERT INTO ticket_columns(
  id,
  board_id,
  kind,
  name,
  sort_order,
  version,
  created_at_utc,
  updated_at_utc
)
VALUES (
  '00000000-0000-4000-8000-000000000107',
  '00000000-0000-4000-8000-000000000100',
  'omit',
  'Omit',
  6,
  0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE TEMP TABLE migration_0018_foreign_key_guard (
  violation_count INTEGER NOT NULL CHECK (violation_count = 0)
);

INSERT INTO migration_0018_foreign_key_guard(violation_count)
SELECT COUNT(*) FROM pragma_foreign_key_check;

DROP TABLE migration_0018_foreign_key_guard;

UPDATE app_meta
SET value = '18', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
