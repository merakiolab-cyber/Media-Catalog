CREATE INDEX IF NOT EXISTS idx_file_entries_scan_path
ON file_entries(media_scan_id, path);
