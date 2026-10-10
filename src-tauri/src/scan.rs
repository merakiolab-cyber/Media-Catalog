use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
pub struct ScanResult {
    pub id: String,
    pub serial_number: String,
    pub file_count: u64,
    pub total_size_bytes: u64,
}

fn compute_fingerprint(entries: &[(String, i64)]) -> String {
    let mut hasher = Sha256::new();
    for (path, size) in entries {
        hasher.update(path.as_bytes());
        hasher.update(&size.to_le_bytes());
    }
    format!("{:x}", hasher.finalize())
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

    let conn =
        Connection::open(db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;

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

    let root_str = path.to_string_lossy();
    let root_len = root_str.len();
    let mut file_count: u64 = 0;
    let mut total_size: u64 = 0;
    let batch_size = 500;
    let mut batch: Vec<(String, String, String, String, String, i32, i64, i64)> = Vec::new();
    let mut fingerprint_entries: Vec<(String, i64)> = Vec::new();

    for entry in WalkDir::new(path)
        .follow_links(false)
        .max_depth(1000)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let full_path = entry.path();
        let full_str = full_path.to_string_lossy();
        let rel_path = if full_str.len() > root_len {
            full_str[root_len..].trim_start_matches(std::path::MAIN_SEPARATOR)
        } else {
            "."
        };
        let name = full_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let is_dir = full_path.is_dir();
        let (size, modified) = if is_dir {
            (0i64, 0i64)
        } else {
            let meta = std::fs::metadata(full_path).ok();
            let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
            let modified = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            (size, modified)
        };

        if !is_dir {
            file_count += 1;
            total_size += size as u64;
        }

        fingerprint_entries.push((rel_path.to_string(), size));

        let entry_id = uuid::Uuid::new_v4().to_string();
        batch.push((
            entry_id,
            scan_id.clone(),
            rel_path.to_string(),
            full_str.to_string(),
            name,
            if is_dir { 1 } else { 0 },
            size,
            modified,
        ));

        if batch.len() >= batch_size {
            insert_batch(&conn, &batch)?;
            batch.clear();
            on_progress(file_count);
        }
    }

    if !batch.is_empty() {
        insert_batch(&conn, &batch)?;
    }
    on_progress(file_count);

    fingerprint_entries.sort_by(|a, b| a.0.cmp(&b.0));
    let media_fingerprint = compute_fingerprint(&fingerprint_entries);

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
    let conn =
        Connection::open(db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;

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

    let started_at = now_ms();
    conn.execute(
        "UPDATE media_scans
         SET drive_path = ?1, scan_started_at = ?2, scan_completed_at = NULL, file_count = 0, total_size_bytes = 0
         WHERE id = ?3",
        rusqlite::params![source_path, started_at, scan_id],
    )
    .map_err(|e| format!("Chyba při přípravě aktualizace skenu: {}", e))?;
    conn.execute(
        "DELETE FROM file_entries WHERE media_scan_id = ?1",
        rusqlite::params![scan_id],
    )
    .map_err(|e| format!("Chyba při mazání původních souborů: {}", e))?;

    let root_str = path.to_string_lossy();
    let root_len = root_str.len();
    let mut file_count: u64 = 0;
    let mut total_size: u64 = 0;
    let batch_size = 500;
    let mut batch: Vec<(String, String, String, String, String, i32, i64, i64)> = Vec::new();
    let mut fingerprint_entries: Vec<(String, i64)> = Vec::new();

    for entry in WalkDir::new(path)
        .follow_links(false)
        .max_depth(1000)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let full_path = entry.path();
        let full_str = full_path.to_string_lossy();
        let rel_path = if full_str.len() > root_len {
            full_str[root_len..].trim_start_matches(std::path::MAIN_SEPARATOR)
        } else {
            "."
        };
        let name = full_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let is_dir = full_path.is_dir();
        let (size, modified) = if is_dir {
            (0i64, 0i64)
        } else {
            let meta = std::fs::metadata(full_path).ok();
            let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
            let modified = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            (size, modified)
        };

        if !is_dir {
            file_count += 1;
            total_size += size as u64;
        }

        fingerprint_entries.push((rel_path.to_string(), size));

        let entry_id = uuid::Uuid::new_v4().to_string();
        batch.push((
            entry_id,
            scan_id.to_string(),
            rel_path.to_string(),
            full_str.to_string(),
            name,
            if is_dir { 1 } else { 0 },
            size,
            modified,
        ));

        if batch.len() >= batch_size {
            insert_batch(&conn, &batch)?;
            batch.clear();
            on_progress(file_count);
        }
    }

    if !batch.is_empty() {
        insert_batch(&conn, &batch)?;
    }
    on_progress(file_count);

    fingerprint_entries.sort_by(|a, b| a.0.cmp(&b.0));
    let media_fingerprint = compute_fingerprint(&fingerprint_entries);

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

fn insert_batch(
    conn: &Connection,
    batch: &[(String, String, String, String, String, i32, i64, i64)],
) -> Result<(), String> {
    let tx = conn.unchecked_transaction();
    let tx = tx.map_err(|e| e.to_string())?;

    for (id, media_scan_id, path, full_path, name, is_dir, size, modified) in batch {
        tx.execute(
            "INSERT INTO file_entries (id, media_scan_id, path, full_path, name, is_directory, size_bytes, modified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![id, media_scan_id, path, full_path, name, is_dir, size, modified],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
