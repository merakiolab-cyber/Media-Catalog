CREATE TABLE IF NOT EXISTS file_entries (
  id TEXT PRIMARY KEY,
  media_scan_id TEXT NOT NULL REFERENCES media_scans(id),
  path TEXT NOT NULL,
  full_path TEXT,
  name TEXT NOT NULL,
  is_directory INTEGER NOT NULL,
  size_bytes INTEGER,
  modified_at INTEGER,
  parent_id TEXT REFERENCES file_entries(id)
);

CREATE INDEX IF NOT EXISTS idx_file_entries_scan ON file_entries(media_scan_id);
CREATE INDEX IF NOT EXISTS idx_file_entries_name ON file_entries(name);
