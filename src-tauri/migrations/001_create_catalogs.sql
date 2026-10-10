CREATE TABLE IF NOT EXISTS catalogs (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES catalogs(id),
  name TEXT NOT NULL,
  created_at INTEGER
);

INSERT INTO catalogs (id, parent_id, name, created_at) VALUES ('root', NULL, 'Vše', strftime('%s', 'now') * 1000);
