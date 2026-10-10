INSERT OR IGNORE INTO catalogs (id, parent_id, name, created_at) VALUES
  ('cat-work', 'root', 'Práce', strftime('%s', 'now') * 1000),
  ('cat-photos', 'root', 'Fotky', strftime('%s', 'now') * 1000),
  ('cat-backups', 'root', 'Zálohy', strftime('%s', 'now') * 1000);
