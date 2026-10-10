// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri_plugin_sql::{Builder, Migration, MigrationKind};

mod commands;
mod db;
mod scan;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_catalogs",
            sql: include_str!("../migrations/001_create_catalogs.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_media_scans",
            sql: include_str!("../migrations/002_create_media_scans.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_file_entries",
            sql: include_str!("../migrations/003_create_file_entries.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_is_favorite",
            sql: include_str!("../migrations/004_add_is_favorite.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_media_fingerprint",
            sql: include_str!("../migrations/005_add_media_fingerprint.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "seed_catalogs",
            sql: include_str!("../migrations/006_seed_catalogs.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "file_entries_scan_path_index",
            sql: include_str!("../migrations/007_file_entries_scan_path_index.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "wal_mode",
            sql: include_str!("../migrations/008_wal_mode.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            Builder::default()
                // Legacy AppData DB (plugin-sql); aktivní katalog je v CDMediacatalog přes rusqlite.
                .add_migrations("sqlite:media_catalog.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            db::ensure_database(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_drives,
            commands::export_database,
            commands::import_database,
            commands::quit_application,
            commands::scan_path,
            commands::refresh_media_scan,
            commands::update_media_scan,
            commands::move_scan_to_catalog,
            commands::delete_media_scan,
            commands::toggle_favorite,
            commands::list_cdrom_drives,
            commands::search_catalog,
            commands::search_catalog_files,
            commands::list_file_entries,
            commands::search_file_entries,
            commands::list_catalogs,
            commands::list_media_scans,
            commands::get_media_scan,
            commands::get_catalog_stats,
            commands::get_database_path,
            commands::create_catalog,
            commands::update_catalog,
            commands::delete_catalog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
