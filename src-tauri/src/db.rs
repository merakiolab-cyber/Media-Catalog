use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

static DB_PATH: OnceLock<PathBuf> = OnceLock::new();
static INIT_LOCK: Mutex<()> = Mutex::new(());

fn legacy_appdata_db_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("media_catalog.db"))
}

fn find_latest_backup(dir: &Path) -> Option<PathBuf> {
    let mut backups: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("media_catalog_backup_") && n.ends_with(".db"))
                .unwrap_or(false)
        })
        .collect();
    backups.sort_by(|a, b| b.cmp(a)); // jméno obsahuje datum YYYY-MM-DD
    backups.into_iter().next()
}

fn table_exists(conn: &rusqlite::Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        rusqlite::params![name],
        |_| Ok(true),
    )
    .unwrap_or(false)
}

fn apply_migrations(path: &Path) -> Result<(), String> {
    let conn = rusqlite::Connection::open(path)
        .map_err(|e| format!("Nelze otevřít databázi pro migrace: {}", e))?;
    conn.busy_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| format!("Nelze nastavit timeout: {}", e))?;

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS app_schema_version (
            version INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("Chyba při přípravě migrací: {}", e))?;

    let mut current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM app_schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // Existující DB (AppData / záloha) už má schéma z plugin-sql – označit jako aktuální.
    if current == 0 && table_exists(&conn, "catalogs") {
        conn.execute(
            "INSERT INTO app_schema_version (version) VALUES (8)",
            [],
        )
        .map_err(|e| format!("Nelze označit existující schéma: {}", e))?;
        let _ = conn.execute_batch(include_str!("../migrations/008_wal_mode.sql"));
        return Ok(());
    }

    let migrations: &[(i64, &str)] = &[
        (1, include_str!("../migrations/001_create_catalogs.sql")),
        (2, include_str!("../migrations/002_create_media_scans.sql")),
        (3, include_str!("../migrations/003_create_file_entries.sql")),
        (4, include_str!("../migrations/004_add_is_favorite.sql")),
        (5, include_str!("../migrations/005_add_media_fingerprint.sql")),
        (6, include_str!("../migrations/006_seed_catalogs.sql")),
        (7, include_str!("../migrations/007_file_entries_scan_path_index.sql")),
        (8, include_str!("../migrations/008_wal_mode.sql")),
        (9, include_str!("../migrations/009_drop_unused_name_index.sql")),
    ];

    for (version, sql) in migrations {
        if current >= *version {
            continue;
        }
        conn.execute_batch(sql)
            .map_err(|e| format!("Migrace {} selhala: {}", version, e))?;
        conn.execute(
            "INSERT INTO app_schema_version (version) VALUES (?1)",
            rusqlite::params![version],
        )
        .map_err(|e| format!("Nelze uložit verzi migrace {}: {}", version, e))?;
        current = *version;
    }

    Ok(())
}

/// Zajistí složku CDMediacatalog, případně zkopíruje DB z nejnovější zálohy / AppData,
/// a aplikuje migrace.
///
/// Priorita zdroje při chybějícím `media_catalog.db`:
/// 1. nejnovější `media_catalog_backup_*.db` ve složce CDMediacatalog
/// 2. legacy AppData DB
pub fn ensure_database(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = {
        let raw = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("CDMediacatalog");
        fs::create_dir_all(&raw)
            .map_err(|e| format!("Nelze vytvořit složku CDMediacatalog: {}", e))?;
        raw.canonicalize()
            .map_err(|e| format!("Nelze vyřešit cestu CDMediacatalog: {}", e))?
    };

    let path = dir.join("media_catalog.db");

    if !path.exists() {
        let mut seeded = false;

        // Aktuální katalog je v CDMediacatalog (zálohy), ne v AppData.
        if let Some(backup) = find_latest_backup(&dir) {
            fs::copy(&backup, &path).map_err(|e| {
                format!(
                    "Nelze zkopírovat zálohu {:?} do media_catalog.db: {}",
                    backup, e
                )
            })?;
            seeded = true;
        }

        if !seeded {
            if let Some(legacy) = legacy_appdata_db_path(app) {
                if legacy.exists() {
                    fs::copy(&legacy, &path).map_err(|e| {
                        format!(
                            "Nelze zkopírovat databázi z AppData do CDMediacatalog: {}",
                            e
                        )
                    })?;
                }
            }
        }
    }

    apply_migrations(&path)?;
    Ok(path)
}

pub fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = DB_PATH.get() {
        return Ok(path.clone());
    }

    let _guard = INIT_LOCK
        .lock()
        .map_err(|_| "Nelze zamknout inicializaci databáze".to_string())?;

    if let Some(path) = DB_PATH.get() {
        return Ok(path.clone());
    }

    let path = ensure_database(app)?;
    let _ = DB_PATH.set(path.clone());
    Ok(path)
}
