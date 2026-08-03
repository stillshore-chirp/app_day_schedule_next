CREATE TABLE ticket_focus_attributions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  focus_session_id TEXT NOT NULL UNIQUE REFERENCES focus_sessions(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  schedule_id TEXT REFERENCES schedule_items(id) ON DELETE SET NULL,
  captured_link_id TEXT NOT NULL CHECK (length(captured_link_id) = 36),
  captured_link_version INTEGER NOT NULL CHECK (captured_link_version >= 0),
  source TEXT NOT NULL CHECK (source IN ('focus_start')),
  attributed_at_utc TEXT NOT NULL
);

CREATE INDEX ticket_focus_attributions_ticket_idx
  ON ticket_focus_attributions(ticket_id, attributed_at_utc DESC, focus_session_id);

CREATE INDEX focus_history_session_phase_idx
  ON focus_history(session_id, from_phase);

UPDATE app_meta
SET value = '16', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
