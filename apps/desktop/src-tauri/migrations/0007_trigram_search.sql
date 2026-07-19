DROP TRIGGER IF EXISTS schedule_items_fts_insert;
DROP TRIGGER IF EXISTS schedule_items_fts_delete;
DROP TRIGGER IF EXISTS schedule_items_fts_update;
DROP TABLE IF EXISTS schedule_items_fts;

CREATE VIRTUAL TABLE schedule_items_fts USING fts5(
  title,
  description,
  location,
  project,
  category,
  tags,
  content='schedule_items',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER schedule_items_fts_insert AFTER INSERT ON schedule_items BEGIN
  INSERT INTO schedule_items_fts(rowid, title, description, location, project, category, tags)
  VALUES (new.rowid, new.title, new.description, new.location, new.project, new.category, new.tags_json);
END;
CREATE TRIGGER schedule_items_fts_delete AFTER DELETE ON schedule_items BEGIN
  INSERT INTO schedule_items_fts(schedule_items_fts, rowid, title, description, location, project, category, tags)
  VALUES ('delete', old.rowid, old.title, old.description, old.location, old.project, old.category, old.tags_json);
END;
CREATE TRIGGER schedule_items_fts_update AFTER UPDATE ON schedule_items BEGIN
  INSERT INTO schedule_items_fts(schedule_items_fts, rowid, title, description, location, project, category, tags)
  VALUES ('delete', old.rowid, old.title, old.description, old.location, old.project, old.category, old.tags_json);
  INSERT INTO schedule_items_fts(rowid, title, description, location, project, category, tags)
  VALUES (new.rowid, new.title, new.description, new.location, new.project, new.category, new.tags_json);
END;

INSERT INTO schedule_items_fts(rowid, title, description, location, project, category, tags)
SELECT rowid, title, description, location, project, category, tags_json
FROM schedule_items;

UPDATE app_meta
SET value = '7', updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
