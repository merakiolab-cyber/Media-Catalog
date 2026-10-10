CREATE TABLE IF NOT EXISTS media_scans (
  id TEXT PRIMARY KEY,
  catalog_id TEXT NOT NULL REFERENCES catalogs(id),
  serial_number TEXT UNIQUE NOT NULL,
  label TEXT,
  drive_path TEXT,
  scan_started_at INTEGER,
  scan_completed_at INTEGER,
  file_count INTEGER DEFAULT 0,
  total_size_bytes INTEGER DEFAULT 0
);
