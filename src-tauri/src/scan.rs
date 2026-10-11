use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use walkdir::WalkDir;

const BATCH_SIZE: usize = 4000;
const PROGRESS_EVERY: u64 = 200;

#[derive(Debug, Serialize)]
pub struct ScanResult {
    pub id: String,
    pub serial_number: String,
    pub file_count: u64,
    pub total_size_bytes: u64,
}

struct ScannedEntry {
    rel_path: String,
    name: String,
    is_directory: i32,
    size: i64,
    modified: i64,
}

struct ExistingEntry {
    id: String,
    size: i64,
    modified: i64,
    is_directory: i32,
}

fn fingerprint_add(acc: &mut [u8; 32], path: &str, size: i64) {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update(&size.to_le_bytes());
    let hash = hasher.finalize();
    for (left, right) in acc.iter_mut().zip(hash.iter()) {
        *left ^= *right;
    }
}

fn fingerprint_hex(acc: &[u8; 32]) -> String {
    let mut out = String::with_capacity(64);
    for byte in acc {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub fn run_scan<F>(
    db_path: &Path,
    path: &str,
    label: Option<String>,
    catalog_id: Option<String>,
    serial_number_override: Option<String>,
    mut on_progress: F,
) -> Result<ScanResult, String>
where
    F: FnMut(u64),
{
    let catalog_id = catalog_id.as_deref().unwrap_or("root");
    let path = Path::new(path);
    if !path.exists() {
        return Err("Cesta neexistuje".to_string());
    }
    if !path.is_dir() {
        return Err("Zadejte složku, ne soubor".to_string());
    }

    let conn = open_scan_db(db_path)?;

    let serial_number = if let Some(sn) = serial_number_override {
        let sn = sn.trim();
        if sn.is_empty() {
            next_serial_number(&conn)?
        } else {
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM media_scans WHERE serial_number = ?1)",
                    rusqlite::params![sn],
                    |row| row.get::<_, i32>(0),
                )
                .map(|n| n != 0)
                .unwrap_or(true);
            if exists {
                return Err(format!("Číslo disku „{}“ již existuje v katalogu", sn));
            }
            sn.to_string()
        }
    } else {
        next_serial_number(&conn)?
    };
    let scan_id = uuid::Uuid::new_v4().to_string();
    let started_at = now_ms();

    conn.execute(
        "INSERT INTO media_scans (id, catalog_id, serial_number, label, drive_path, scan_started_at, file_count, total_size_bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0)",
        (
            &scan_id,
            catalog_id,
            &serial_number,
            label.as_deref().unwrap_or(""),
            path.to_string_lossy().as_ref(),
            started_at,
        ),
    )
    .map_err(|e| format!("Chyba při ukládání skenu: {}", e))?;

    let (file_count, total_size, media_fingerprint) =
        index_tree(&conn, &scan_id, path, &mut on_progress)?;

    conn.execute(
        "UPDATE media_scans SET scan_completed_at = ?1, file_count = ?2, total_size_bytes = ?3, media_fingerprint = ?4 WHERE id = ?5",
        (now_ms(), file_count as i64, total_size as i64, &media_fingerprint, &scan_id),
    )
    .map_err(|e| format!("Chyba při aktualizaci skenu: {}", e))?;

    Ok(ScanResult {
        id: scan_id,
        serial_number,
        file_count,
        total_size_bytes: total_size,
    })
}

pub fn refresh_scan<F>(
    db_path: &Path,
    scan_id: &str,
    source_path: &str,
    mut on_progress: F,
) -> Result<ScanResult, String>
where
    F: FnMut(u64),
{
    let conn = open_scan_db(db_path)?;

    let serial_number: String = conn
        .query_row(
            "SELECT serial_number FROM media_scans WHERE id = ?1",
            rusqlite::params![scan_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Nelze načíst sken pro aktualizaci: {}", e))?;

    let path = Path::new(source_path);
    if !path.exists() {
        return Err("Cesta skenu neexistuje".to_string());
    }
    if !path.is_dir() {
        return Err("Cesta skenu už není složka".to_string());
    }

    on_progress(0);
    let started_at = now_ms();
    conn.execute(
        "UPDATE media_scans
         SET drive_path = ?1, scan_started_at = ?2, scan_completed_at = NULL
         WHERE id = ?3",
        rusqlite::params![source_path, started_at, scan_id],
    )
    .map_err(|e| format!("Chyba při přípravě aktualizace skenu: {}", e))?;

    let existing = load_existing_entries(&conn, scan_id)?;
    let (file_count, total_size, media_fingerprint) =
        refresh_tree(&conn, scan_id, path, existing, &mut on_progress)?;

    conn.execute(
        "UPDATE media_scans SET scan_completed_at = ?1, file_count = ?2, total_size_bytes = ?3, media_fingerprint = ?4 WHERE id = ?5",
        rusqlite::params![now_ms(), file_count as i64, total_size as i64, &media_fingerprint, scan_id],
    )
    .map_err(|e| format!("Chyba při aktualizaci skenu: {}", e))?;

    Ok(ScanResult {
        id: scan_id.to_string(),
        serial_number,
        file_count,
        total_size_bytes: total_size,
    })
}

fn open_scan_db(db_path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;
    conn.busy_timeout(std::time::Duration::from_secs(30))
        .map_err(|e| format!("Nelze nastavit čekání na databázi: {}", e))?;
    conn.execute_batch(
        "PRAGMA foreign_keys = OFF;
         PRAGMA synchronous = NORMAL;
         PRAGMA temp_store = MEMORY;
         PRAGMA cache_size = -262144;",
    )
    .map_err(|e| format!("Nelze zrychlit zápis skenu: {}", e))?;
    Ok(conn)
}

fn next_serial_number(conn: &Connection) -> Result<String, String> {
    let max: Option<i64> = conn
        .query_row(
            "SELECT MAX(CAST(SUBSTR(serial_number, 4) AS INTEGER)) FROM media_scans WHERE serial_number LIKE 'MC-%'",
            [],
            |row| row.get(0),
        )
        .ok();

    let next = (max.unwrap_or(0) + 1) as u32;
    Ok(format!("MC-{:05}", next))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn load_existing_entries(
    conn: &Connection,
    scan_id: &str,
) -> Result<HashMap<String, ExistingEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, path, COALESCE(size_bytes, 0), COALESCE(modified_at, 0), is_directory
             FROM file_entries WHERE media_scan_id = ?1",
        )
        .map_err(|e| format!("Nelze načíst původní soubory: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![scan_id], |row| {
            Ok((
                row.get::<_, String>(1)?,
                ExistingEntry {
                    id: row.get(0)?,
                    size: row.get(2)?,
                    modified: row.get(3)?,
                    is_directory: row.get(4)?,
                },
            ))
        })
        .map_err(|e| format!("Nelze číst původní soubory: {}", e))?;

    let mut existing = HashMap::new();
    for row in rows {
        let (path, entry) = row.map_err(|e| format!("Nelze číst původní soubor: {}", e))?;
        existing.insert(path, entry);
    }
    Ok(existing)
}

fn scanned_from_dir_entry(entry: &walkdir::DirEntry, root_len: usize) -> ScannedEntry {
    let full_str = entry.path().to_string_lossy();
    let rel_path = if full_str.len() > root_len {
        full_str[root_len..]
            .trim_start_matches(std::path::MAIN_SEPARATOR)
            .to_string()
    } else {
        ".".to_string()
    };
    let name = entry.file_name().to_string_lossy().into_owned();
    let is_dir = entry.file_type().is_dir();
    let (size, modified) = if is_dir {
        (0i64, 0i64)
    } else {
        match entry.metadata() {
            Ok(meta) => {
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                (meta.len() as i64, modified)
            }
            Err(_) => (0i64, 0i64),
        }
    };
    ScannedEntry {
        rel_path,
        name,
        is_directory: if is_dir { 1 } else { 0 },
        size,
        modified,
    }
}

fn walk_source(path: &Path) -> impl Iterator<Item = walkdir::DirEntry> {
    WalkDir::new(path)
        .follow_links(false)
        .max_depth(1000)
        .into_iter()
        .filter_entry(|entry| !is_skipped_dir(entry.file_name()))
        .filter_map(|entry| entry.ok())
}

fn index_tree<F>(
    conn: &Connection,
    scan_id: &str,
    path: &Path,
    on_progress: &mut F,
) -> Result<(u64, u64, String), String>
where
    F: FnMut(u64),
{
    let root_len = path.to_string_lossy().len();
    let mut file_count: u64 = 0;
    let mut total_size: u64 = 0;
    let mut visited: u64 = 0;
    let mut fingerprint = [0u8; 32];
    on_progress(0);
    let mut batch: Vec<(String, String, String, String, i32, i64, i64)> = Vec::new();

    for entry in walk_source(path) {
        let item = scanned_from_dir_entry(&entry, root_len);
        visited += 1;
        if item.is_directory == 0 {
            file_count += 1;
            total_size += item.size as u64;
        }
        fingerprint_add(&mut fingerprint, &item.rel_path, item.size);
        batch.push((
            uuid::Uuid::new_v4().to_string(),
            scan_id.to_string(),
            item.rel_path,
            item.name,
            item.is_directory,
            item.size,
            item.modified,
        ));

        if batch.len() >= BATCH_SIZE {
            insert_batch(conn, &batch)?;
            batch.clear();
        }
        if visited % PROGRESS_EVERY == 0 {
            on_progress(file_count);
        }
    }

    if !batch.is_empty() {
        insert_batch(conn, &batch)?;
    }
    on_progress(file_count);
    Ok((file_count, total_size, fingerprint_hex(&fingerprint)))
}

fn refresh_tree<F>(
    conn: &Connection,
    scan_id: &str,
    path: &Path,
    mut existing: HashMap<String, ExistingEntry>,
    on_progress: &mut F,
) -> Result<(u64, u64, String), String>
where
    F: FnMut(u64),
{
    let root_len = path.to_string_lossy().len();
    let mut file_count: u64 = 0;
    let mut total_size: u64 = 0;
    let mut visited: u64 = 0;
    let mut fingerprint = [0u8; 32];
    on_progress(0);
    let mut inserts: Vec<(String, String, String, String, i32, i64, i64)> = Vec::new();
    let mut updates: Vec<(i64, i64, String, i32, String)> = Vec::new();

    for entry in walk_source(path) {
        let item = scanned_from_dir_entry(&entry, root_len);
        visited += 1;
        if item.is_directory == 0 {
            file_count += 1;
            total_size += item.size as u64;
        }
        fingerprint_add(&mut fingerprint, &item.rel_path, item.size);

        match existing.remove(&item.rel_path) {
            Some(old)
                if old.size == item.size
                    && old.modified == item.modified
                    && old.is_directory == item.is_directory => {}
            Some(old) => updates.push((
                item.size,
                item.modified,
                item.name,
                item.is_directory,
                old.id,
            )),
            None => inserts.push((
                uuid::Uuid::new_v4().to_string(),
                scan_id.to_string(),
                item.rel_path,
                item.name,
                item.is_directory,
                item.size,
                item.modified,
            )),
        }

        if inserts.len() >= BATCH_SIZE {
            insert_batch(conn, &inserts)?;
            inserts.clear();
        }
        if updates.len() >= BATCH_SIZE {
            update_batch(conn, &updates)?;
            updates.clear();
        }
        if visited % PROGRESS_EVERY == 0 {
            on_progress(file_count);
        }
    }

    if !inserts.is_empty() {
        insert_batch(conn, &inserts)?;
    }
    if !updates.is_empty() {
        update_batch(conn, &updates)?;
    }

    let leftover: Vec<String> = existing.into_values().map(|entry| entry.id).collect();
    delete_ids(conn, &leftover)?;
    on_progress(file_count);
    Ok((file_count, total_size, fingerprint_hex(&fingerprint)))
}

fn is_skipped_dir(name: &std::ffi::OsStr) -> bool {
    let name = name.to_string_lossy();
    name.eq_ignore_ascii_case("System Volume Information")
        || name.eq_ignore_ascii_case("$RECYCLE.BIN")
        || name.eq_ignore_ascii_case("$Recycle.Bin")
        || name.eq_ignore_ascii_case("RECYCLER")
}

fn insert_batch(
    conn: &Connection,
    batch: &[(String, String, String, String, i32, i64, i64)],
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO file_entries (id, media_scan_id, path, name, is_directory, size_bytes, modified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| e.to_string())?;
        for (id, media_scan_id, path, name, is_dir, size, modified) in batch {
            stmt.execute(rusqlite::params![
                id,
                media_scan_id,
                path,
                name,
                is_dir,
                size,
                modified
            ])
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn update_batch(
    conn: &Connection,
    batch: &[(i64, i64, String, i32, String)],
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "UPDATE file_entries SET size_bytes = ?1, modified_at = ?2, name = ?3, is_directory = ?4 WHERE id = ?5",
            )
            .map_err(|e| e.to_string())?;
        for (size, modified, name, is_dir, id) in batch {
            stmt.execute(rusqlite::params![size, modified, name, is_dir, id])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn delete_ids(conn: &Connection, ids: &[String]) -> Result<(), String> {
    for chunk in ids.chunks(BATCH_SIZE) {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare("DELETE FROM file_entries WHERE id = ?1")
                .map_err(|e| e.to_string())?;
            for id in chunk {
                stmt.execute(rusqlite::params![id])
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}
