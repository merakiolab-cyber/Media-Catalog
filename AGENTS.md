# Media Catalog - Agent Guidelines

## Purpose

Offline desktop app for indexing physical media (CD, DVD) file structures. Users scan drives/folders and search the catalog without inserting the disc.

## Source of truth

1. `.cursorrules` – stack, struktura appky, konvence UI
2. `.cursor/rules/lessons-learned.mdc` – chyby, které se nesmí opakovat
3. `CHANGELOG.md` – historie změn a poznámky k vývoji

## Key commands (Rust / `commands.rs`)

- Drives: `list_drives`, `list_cdrom_drives`
- Scans: `scan_path`, `refresh_media_scan`, `update_media_scan`, `delete_media_scan`, `move_scan_to_catalog`, `toggle_favorite`, `list_media_scans`, `get_media_scan`
- Catalogs: `list/create/update/delete_catalog`, `get_catalog_stats`
- Files: `list_file_entries`, `search_file_entries`, `search_catalog`, `search_catalog_files`
- DB: `export_database`, `import_database`, `get_database_path`, `quit_application`

## Frontend

- Sidebar: hierarchie katalogů, Favorites, Nový sken, import/export
- Detail: `CDDetailPanel` (ne dialog) – strom souborů, search, refresh skenu
- Main: ScannerPanel / CatalogDashboard

## Database

- Aktivní: `CDMediacatalog/media_catalog.db` (vedle kořene projektu)
- Tables: `catalogs`, `media_scans`, `file_entries`
- Access: rusqlite přes `invoke` (`db.rs` + `ensure_database` OnceLock)

## Run

| Režim | Příkaz |
|-------|--------|
| UI only (bez backendu) | `npm run dev` |
| Desktop dev | `npm run tauri:dev` |
| Produkční `.exe` | `npm run tauri:build` |

Nikdy netestuj DB/`invoke` jen v prohlížeči. Nikdy nestavěj release jen přes `cargo build --release`.
