-- fold_name(name) LIKE nemůže tento index použít a každé mazání/insert ho přepisuje.
DROP INDEX IF EXISTS idx_file_entries_name;
