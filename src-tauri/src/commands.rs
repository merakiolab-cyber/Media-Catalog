use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::Emitter;

use crate::db;
use crate::scan;

#[derive(Debug, Serialize, Deserialize)]
pub struct DriveInfo {
    pub letter: String,
    pub path: String,
}

#[tauri::command]
pub fn list_cdrom_drives() -> Result<Vec<DriveInfo>, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;
        const DRIVE_CDROM: u32 = 5;

        let mut drives = Vec::new();
        for letter in b'A'..=b'Z' {
            let path_str = format!("{}:\\", letter as char);
            let path = Path::new(&path_str);
            if !path.exists() {
                continue;
            }

            let wide: Vec<u16> = path_str.encode_utf16().chain(std::iter::once(0)).collect();
            let drive_type = unsafe { GetDriveTypeW(wide.as_ptr()) };
            if drive_type == DRIVE_CDROM {
                drives.push(DriveInfo {
                    letter: format!("{}:", letter as char),
                    path: path_str,
                });
            }
        }
        Ok(drives)
    }

    #[cfg(not(windows))]
    {
        let mut drives = Vec::new();
        #[cfg(target_os = "linux")]
        {
            if Path::new("/media").exists() {
                for entry in std::fs::read_dir("/media").unwrap_or_default().flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string();
                        if !name.is_empty() {
                            drives.push(DriveInfo {
                                letter: name.clone(),
                                path: path.to_string_lossy().to_string(),
                            });
                        }
                    }
                }
            }
        }
        #[cfg(target_os = "macos")]
        {
            if Path::new("/Volumes").exists() {
                for entry in std::fs::read_dir("/Volumes").unwrap_or_default().flatten() {
                    let path = entry.path();
                    if path.is_dir() && path != Path::new("/Volumes") {
                        let name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string();
                        if !name.is_empty() {
                            drives.push(DriveInfo {
                                letter: name.clone(),
                                path: path.to_string_lossy().to_string(),
                            });
                        }
                    }
                }
            }
        }
        Ok(drives)
    }
}

#[tauri::command]
pub fn list_drives() -> Result<Vec<DriveInfo>, String> {
    #[cfg(windows)]
    {
        let mut drives = Vec::new();
        for letter in b'A'..=b'Z' {
            let path_str = format!("{}:\\", letter as char);
            let path = Path::new(&path_str);
            if path.exists() {
                drives.push(DriveInfo {
                    letter: format!("{}:", letter as char),
                    path: path_str,
                });
            }
        }
        Ok(drives)
    }

    #[cfg(not(windows))]
    {
        let mut drives = Vec::new();
        #[cfg(target_os = "linux")]
        {
            if Path::new("/media").exists() {
                for entry in std::fs::read_dir("/media").unwrap_or_default().flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string();
                        if !name.is_empty() {
                            drives.push(DriveInfo {
                                letter: name.clone(),
                                path: path.to_string_lossy().to_string(),
                            });
                        }
                    }
                }
            }
            if drives.is_empty() {
                drives.push(DriveInfo {
                    letter: "/".to_string(),
                    path: "/".to_string(),
                });
            }
        }
        #[cfg(target_os = "macos")]
        {
            if Path::new("/Volumes").exists() {
                for entry in std::fs::read_dir("/Volumes").unwrap_or_default().flatten() {
                    let path = entry.path();
                    if path.is_dir() && path != Path::new("/Volumes") {
                        let name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string();
                        if !name.is_empty() {
                            drives.push(DriveInfo {
                                letter: name.clone(),
                                path: path.to_string_lossy().to_string(),
                            });
                        }
                    }
                }
            }
        }
        Ok(drives)
    }
}

#[tauri::command]
pub fn update_media_scan(
    app: tauri::AppHandle,
    id: String,
    label: String,
    serial_number: String,
    catalog_id: Option<String>,
) -> Result<(), String> {
    let db_path = db::get_db_path(&app)?;

    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;

    let sn = serial_number.trim();
    if sn.is_empty() {
        return Err("Číslo disku nemůže být prázdné".to_string());
    }
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM media_scans WHERE serial_number = ?1 AND id != ?2",
            rusqlite::params![sn, id],
            |row| row.get(0),
        )
        .ok();
    if existing.is_some() {
        return Err("Toto číslo disku již používá jiný záznam".to_string());
    }

    let cat_id = catalog_id.unwrap_or_else(|| "root".to_string());
    conn.execute(
        "UPDATE media_scans SET label = ?1, serial_number = ?2, catalog_id = ?3 WHERE id = ?4",
        rusqlite::params![label, sn, cat_id, id],
    )
    .map_err(|e| format!("Chyba při úpravě: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn move_scan_to_catalog(app: tauri::AppHandle, scan_id: String, catalog_id: String) -> Result<(), String> {
    let db_path = db::get_db_path(&app)?;

    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;

    conn.execute(
        "UPDATE media_scans SET catalog_id = ?1 WHERE id = ?2",
        rusqlite::params![catalog_id, scan_id],
    )
    .map_err(|e| format!("Chyba při přesunu: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn delete_media_scan(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let db_path = db::get_db_path(&app)?;
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Nelze otevřít databázi: {}", e))?;
    conn.busy_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| format!("Nelze nastavit timeout: {}", e))?;
    conn.execute(
        "DELETE FROM file_entries WHERE media_scan_id = ?1",
        rusqlite::params![&id],
    )
    .map_err(|e| format!("Chyba při mazání souborů: {}", e))?;
    conn.execute("DELETE FROM media_scans WHERE id = ?1", rusqlite::params![&id])
        .map_err(|e| format!("Chyba při mazání skenu: {}", e))?;
    let _ = app.emit("scan-deleted", &id);
    Ok(())
}

#[tauri::command]
pub fn toggle_favorite(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    let db_path = db::get_db_path(&app)?;

    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;
    let current: i32 = conn
        .query_row(
            "SELECT COALESCE(is_favorite, 0) FROM media_scans WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Nelze načíst stav: {}", e))?;
    let new_val = if current == 1 { 0 } else { 1 };
    conn.execute(
        "UPDATE media_scans SET is_favorite = ?1 WHERE id = ?2",
        rusqlite::params![new_val, id],
    )
    .map_err(|e| format!("Chyba při úpravě oblíbeného: {}", e))?;
    Ok(new_val == 1)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CatalogInfo {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntryInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    pub is_directory: i32,
    pub size_bytes: Option<i64>,
    pub modified_at: Option<i64>,
}

#[tauri::command]
pub fn list_file_entries(
    app: tauri::AppHandle,
    scan_id: String,
    parent_path: Option<String>,
) -> Result<Vec<FileEntryInfo>, String> {
    let db_path = get_db_path(&app)?;
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;

    let parent = parent_path.unwrap_or_default().trim().to_string();

    let mut result: Vec<FileEntryInfo> = if parent.is_empty() {
        // Root: paths with no slash (single segment)
        let mut stmt = conn
            .prepare(
                "SELECT id, path, name, is_directory, size_bytes, modified_at FROM file_entries 
                 WHERE media_scan_id = ?1 AND path NOT LIKE '%/%' AND path NOT LIKE '%' || char(92) || '%' 
                 ORDER BY path",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![scan_id], |row| {
                Ok(FileEntryInfo {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    name: row.get(2)?,
                    is_directory: row.get(3)?,
                    size_bytes: row.get(4)?,
                    modified_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    } else {
        // Direct children: path starts with parent/ or parent\ and has no further separator
        let parent_norm = parent.replace('\\', "/");
        let like_prefix_fwd = format!("{}/%", parent_norm);
        let like_prefix_fwd_deep = format!("{}/%/%", parent_norm);
        let parent_bwd = parent.replace('/', "\\");
        let like_prefix_bwd = format!("{}\\%", parent_bwd);
        let like_prefix_bwd_deep = format!("{}\\%\\%", parent_bwd);
        let mut stmt = conn
            .prepare(
                "SELECT id, path, name, is_directory, size_bytes, modified_at FROM file_entries 
                 WHERE media_scan_id = ?1 
                 AND (
                   (path LIKE ?2 AND path NOT LIKE ?3) 
                   OR (path LIKE ?4 AND path NOT LIKE ?5)
                 )
                 ORDER BY path",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(
                rusqlite::params![
                    scan_id,
                    like_prefix_fwd,
                    like_prefix_fwd_deep,
                    like_prefix_bwd,
                    like_prefix_bwd_deep
                ],
                |row| {
                    Ok(FileEntryInfo {
                        id: row.get(0)?,
                        path: row.get(1)?,
                        name: row.get(2)?,
                        is_directory: row.get(3)?,
                        size_bytes: row.get(4)?,
                        modified_at: row.get(5)?,
                    })
                },
            )
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    result.sort_by(|a, b| {
        let a_is_dir = a.is_directory != 0;
        let b_is_dir = b.is_directory != 0;
        if a_is_dir != b_is_dir {
            return if a_is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });
    Ok(result)
}

/// Srovná české diakritiky a velikost písmen, ať „Hájek“ najde i „hajek“.
fn fold_search(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        let folded = match ch {
            'á' | 'Á' => 'a',
            'č' | 'Č' => 'c',
            'ď' | 'Ď' => 'd',
            'é' | 'É' | 'ě' | 'Ě' => 'e',
            'í' | 'Í' => 'i',
            'ň' | 'Ň' => 'n',
            'ó' | 'Ó' => 'o',
            'ř' | 'Ř' => 'r',
            'š' | 'Š' => 's',
            'ť' | 'Ť' => 't',
            'ú' | 'Ú' | 'ů' | 'Ů' => 'u',
            'ý' | 'Ý' => 'y',
            'ž' | 'Ž' => 'z',
            other => other.to_ascii_lowercase(),
        };
        out.push(folded);
    }
    out
}

fn like_contains_pattern(query: &str) -> String {
    let folded = fold_search(query.trim());
    let mut escaped = String::new();
    for ch in folded.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    format!("%{escaped}%")
}

fn register_fold_name(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.create_scalar_function(
        "fold_name",
        1,
        rusqlite::functions::FunctionFlags::SQLITE_UTF8
            | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let value: String = ctx.get(0).unwrap_or_default();
            Ok(fold_search(&value))
        },
    )
    .map_err(|e| format!("Nelze připravit vyhledávání: {}", e))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CatalogFileHit {
    pub id: String,
    pub path: String,
    pub name: String,
    pub is_directory: i32,
    pub size_bytes: Option<i64>,
    pub modified_at: Option<i64>,
    pub media_scan_id: String,
    pub serial_number: String,
    pub scan_label: Option<String>,
    pub drive_path: String,
    pub scan_completed_at: Option<i64>,
    pub file_count: i64,
    pub total_size_bytes: i64,
    pub is_favorite: i32,
    pub catalog_id: Option<String>,
    pub catalog_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CatalogFileSearch {
    pub hits: Vec<CatalogFileHit>,
    pub truncated: bool,
}

#[tauri::command]
pub fn search_catalog_files(
    app: tauri::AppHandle,
    query: String,
    limit: Option<u32>,
) -> Result<CatalogFileSearch, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(CatalogFileSearch {
            hits: vec![],
            truncated: false,
        });
    }
    let cap = limit.unwrap_or(500).clamp(1, 1000);
    let pattern = like_contains_pattern(q);
    let db_path = get_db_path(&app)?;
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(8));
    register_fold_name(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT fe.id, fe.path, fe.name, fe.is_directory, fe.size_bytes, fe.modified_at,
                    fe.media_scan_id, m.serial_number, m.label, COALESCE(m.drive_path, ''),
                    m.scan_completed_at, COALESCE(m.file_count, 0), COALESCE(m.total_size_bytes, 0),
                    COALESCE(m.is_favorite, 0), m.catalog_id, c.name
             FROM file_entries fe
             JOIN media_scans m ON m.id = fe.media_scan_id
             LEFT JOIN catalogs c ON c.id = m.catalog_id
             WHERE fold_name(fe.name) LIKE ?1 ESCAPE '\\'
             ORDER BY fe.is_directory DESC, fe.name COLLATE NOCASE, m.serial_number
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let fetch = cap + 1;
    let rows = stmt
        .query_map(rusqlite::params![pattern, fetch], |row| {
            Ok(CatalogFileHit {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                is_directory: row.get(3)?,
                size_bytes: row.get(4)?,
                modified_at: row.get(5)?,
                media_scan_id: row.get(6)?,
                serial_number: row.get(7)?,
                scan_label: row.get(8)?,
                drive_path: row.get(9)?,
                scan_completed_at: row.get(10)?,
                file_count: row.get(11)?,
                total_size_bytes: row.get(12)?,
                is_favorite: row.get(13)?,
                catalog_id: row.get(14)?,
                catalog_name: row.get(15)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut hits: Vec<CatalogFileHit> = rows.filter_map(|r| r.ok()).collect();
    let truncated = hits.len() > cap as usize;
    hits.truncate(cap as usize);
    Ok(CatalogFileSearch { hits, truncated })
}

#[tauri::command]
pub fn search_file_entries(
    app: tauri::AppHandle,
    scan_id: String,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<FileEntryInfo>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let cap = limit.unwrap_or(500).min(1000);
    let pattern = like_contains_pattern(q);
    let db_path = get_db_path(&app)?;
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(8));
    register_fold_name(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, path, name, is_directory, size_bytes, modified_at FROM file_entries 
             WHERE media_scan_id = ?1 AND fold_name(name) LIKE ?2 ESCAPE '\\'
             ORDER BY is_directory DESC, name COLLATE NOCASE LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![scan_id, pattern, cap], |row| {
            Ok(FileEntryInfo {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                is_directory: row.get(3)?,
                size_bytes: row.get(4)?,
                modified_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let result: Vec<FileEntryInfo> = rows.filter_map(|r| r.ok()).collect();
    Ok(result)
}

#[tauri::command]
pub fn search_catalog(app: tauri::AppHandle, query: String) -> Result<Vec<String>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let pattern = format!("%{}%", q);
    let db_path = get_db_path(&app)?;
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;

    let mut scan_ids = std::collections::HashSet::new();

    // Scans matching label, serial_number, drive_path
    let mut stmt = conn
        .prepare(
            "SELECT id FROM media_scans WHERE label LIKE ?1 OR serial_number LIKE ?1 OR drive_path LIKE ?1",
        )
        .map_err(|e| e.to_string())?;
    for row in stmt
        .query_map(rusqlite::params![pattern], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
    {
        if let Ok(id) = row {
            scan_ids.insert(id);
        }
    }

    // Scans that have file entries matching path or name
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT media_scan_id FROM file_entries WHERE path LIKE ?1 OR name LIKE ?1",
        )
        .map_err(|e| e.to_string())?;
    for row in stmt
        .query_map(rusqlite::params![pattern], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
    {
        if let Ok(id) = row {
            scan_ids.insert(id);
        }
    }

    let mut result: Vec<String> = scan_ids.into_iter().collect();
    result.sort();
    Ok(result)
}

fn get_db_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    db::get_db_path(app)
}

#[tauri::command]
pub fn export_database(app: tauri::AppHandle, target_path: String) -> Result<String, String> {
    let db_path = get_db_path(&app)?;
    let target = Path::new(&target_path);

    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(conn) => conn,
        Err(e) => return Err(format!("Nelze otevřít databázi: {}", e)),
    };
    let checkpoint_result: Result<(i64, i64, i64), rusqlite::Error> = conn.query_row(
        "PRAGMA wal_checkpoint(TRUNCATE)",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    );
    if let Err(e) = checkpoint_result {
        return Err(format!("Chyba při checkpointu: {}", e));
    }
    drop(conn);

    let target_path_buf = if target.extension().is_none() {
        target_path + ".db"
    } else {
        target_path
    };

    if let Err(e) = std::fs::copy(&db_path, &target_path_buf) {
        return Err(format!("Chyba při kopírování databáze: {}", e));
    }
    Ok(target_path_buf)
}

#[tauri::command]
pub fn import_database(app: tauri::AppHandle, source_path: String) -> Result<(), String> {
    let db_path = get_db_path(&app)?;
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err("Vybraný soubor databáze neexistuje.".to_string());
    }
    if !source.is_file() {
        return Err("Vybraná cesta není soubor databáze.".to_string());
    }

    let mut conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;
    conn.busy_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| format!("Nelze nastavit timeout databáze: {}", e))?;

    conn.execute("PRAGMA foreign_keys = OFF", [])
        .map_err(|e| format!("Nelze vypnout foreign keys: {}", e))?;
    conn.execute("ATTACH DATABASE ?1 AS imported", rusqlite::params![source_path.clone()])
        .map_err(|e| format!("Nelze připojit importovanou databázi: {}", e))?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Nelze začít import transakci: {}", e))?;

    tx.execute("DELETE FROM file_entries", [])
        .map_err(|e| format!("Chyba při mazání file_entries: {}", e))?;
    tx.execute("DELETE FROM media_scans", [])
        .map_err(|e| format!("Chyba při mazání media_scans: {}", e))?;
    tx.execute("DELETE FROM catalogs", [])
        .map_err(|e| format!("Chyba při mazání catalogs: {}", e))?;

    tx.execute(
        "INSERT OR REPLACE INTO catalogs (id, parent_id, name, created_at)
         SELECT id, parent_id, name, created_at FROM imported.catalogs",
        [],
    )
    .map_err(|e| format!("Chyba při importu catalogs: {}", e))?;
    tx.execute(
        "INSERT OR REPLACE INTO media_scans (
            id, catalog_id, serial_number, label, drive_path, scan_started_at, scan_completed_at,
            file_count, total_size_bytes, is_favorite, media_fingerprint
         )
         SELECT
            id, catalog_id, serial_number, label, drive_path, scan_started_at, scan_completed_at,
            file_count, total_size_bytes, COALESCE(is_favorite, 0), media_fingerprint
         FROM imported.media_scans",
        [],
    )
    .map_err(|e| format!("Chyba při importu media_scans: {}", e))?;
    tx.execute(
        "INSERT OR REPLACE INTO file_entries (
            id, media_scan_id, path, full_path, name, is_directory, size_bytes, modified_at, parent_id
         )
         SELECT
            id, media_scan_id, path, full_path, name, is_directory, size_bytes, modified_at, parent_id
         FROM imported.file_entries",
        [],
    )
    .map_err(|e| format!("Chyba při importu file_entries: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Nelze potvrdit import transakci: {}", e))?;

    conn.execute("DETACH DATABASE imported", [])
        .map_err(|e| format!("Nelze odpojit importovanou databázi: {}", e))?;
    conn.execute("PRAGMA foreign_keys = ON", [])
        .map_err(|e| format!("Nelze zapnout foreign keys: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn quit_application(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn list_catalogs(app: tauri::AppHandle) -> Result<Vec<CatalogInfo>, String> {
    let db_path = get_db_path(&app)?;
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));
    let mut stmt = conn
        .prepare("SELECT id, parent_id, name FROM catalogs ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CatalogInfo {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut catalogs: Vec<CatalogInfo> = rows.filter_map(|r| r.ok()).collect();
    catalogs.sort_by(|a, b| {
        if a.id == "root" {
            std::cmp::Ordering::Less
        } else if b.id == "root" {
            std::cmp::Ordering::Greater
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });
    Ok(catalogs)
}

#[tauri::command]
pub fn create_catalog(
    app: tauri::AppHandle,
    parent_id: Option<String>,
    name: String,
) -> Result<CatalogInfo, String> {
    let parent_id = parent_id.as_deref().unwrap_or("root");
    let db_path = get_db_path(&app)?;
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;
    let id = format!("cat-{}", uuid::Uuid::new_v4().to_string().replace('-', "").chars().take(8).collect::<String>());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO catalogs (id, parent_id, name, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, parent_id, name.trim(), now],
    )
    .map_err(|e| format!("Chyba při vytváření katalogu: {}", e))?;
    Ok(CatalogInfo {
        id: id.clone(),
        parent_id: Some(parent_id.to_string()),
        name: name.trim().to_string(),
    })
}

#[tauri::command]
pub fn update_catalog(app: tauri::AppHandle, id: String, name: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Název nesmí být prázdný".to_string());
    }
    if id == "root" {
        return Err("Katalog „Vše“ nelze přejmenovat".to_string());
    }
    let db_path = get_db_path(&app)?;
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;
    conn.execute("UPDATE catalogs SET name = ?1 WHERE id = ?2", rusqlite::params![name, id])
        .map_err(|e| format!("Chyba při úpravě katalogu: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn delete_catalog(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if id == "root" {
        return Err("Katalog „Vše“ nelze smazat".to_string());
    }
    let db_path = get_db_path(&app)?;
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;
    conn.execute("UPDATE media_scans SET catalog_id = 'root' WHERE catalog_id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("UPDATE catalogs SET parent_id = 'root' WHERE parent_id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM catalogs WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("Chyba při mazání katalogu: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn scan_path(
    app: tauri::AppHandle,
    path: String,
    label: Option<String>,
    catalog_id: Option<String>,
    serial_number: Option<String>,
) -> Result<scan::ScanResult, String> {
    let db_path = db::get_db_path(&app)?;
    run_scan_off_main(app, move |on_progress| {
        scan::run_scan(
            &db_path,
            &path,
            label,
            catalog_id,
            serial_number,
            on_progress,
        )
    })
    .await
}

#[tauri::command]
pub async fn refresh_media_scan(
    app: tauri::AppHandle,
    id: String,
    source_path: String,
) -> Result<scan::ScanResult, String> {
    let db_path = db::get_db_path(&app)?;
    run_scan_off_main(app, move |on_progress| {
        scan::refresh_scan(&db_path, &id, &source_path, on_progress)
    })
    .await
}

async fn run_scan_off_main<F>(
    app: tauri::AppHandle,
    scan: F,
) -> Result<scan::ScanResult, String>
where
    F: FnOnce(&mut dyn FnMut(u64)) -> Result<scan::ScanResult, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let progress_app = app.clone();
        let mut last_files = 0u64;
        let outcome = scan(&mut |files| {
            last_files = files;
            let _ = progress_app.emit(
                "scan-progress",
                serde_json::json!({ "files": files, "done": false }),
            );
        });
        let _ = app.emit(
            "scan-progress",
            serde_json::json!({ "files": last_files, "done": true }),
        );
        outcome
    })
    .await
    .map_err(|e| format!("Sken byl přerušen: {}", e))?
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MediaScanInfo {
    pub id: String,
    pub serial_number: String,
    pub label: Option<String>,
    pub drive_path: String,
    pub scan_completed_at: Option<i64>,
    pub file_count: i64,
    pub total_size_bytes: i64,
    pub is_favorite: i32,
    pub catalog_id: Option<String>,
    pub catalog_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CatalogStats {
    pub catalogs_count: i64,
    pub scans_count: i64,
    pub total_files: i64,
    pub total_bytes: i64,
}

#[tauri::command]
pub fn list_media_scans(app: tauri::AppHandle) -> Result<Vec<MediaScanInfo>, String> {
    let db_path = db::get_db_path(&app)?;
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));
    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.serial_number, m.label, COALESCE(m.drive_path, ''), m.scan_completed_at,
                    COALESCE(m.file_count, 0), COALESCE(m.total_size_bytes, 0),
                    COALESCE(m.is_favorite, 0) as is_favorite,
                    m.catalog_id, c.name as catalog_name
             FROM media_scans m
             LEFT JOIN catalogs c ON m.catalog_id = c.id
             ORDER BY c.name, m.scan_completed_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(MediaScanInfo {
                id: row.get(0)?,
                serial_number: row.get(1)?,
                label: row.get(2)?,
                drive_path: row.get(3)?,
                scan_completed_at: row.get(4)?,
                file_count: row.get(5)?,
                total_size_bytes: row.get(6)?,
                is_favorite: row.get(7)?,
                catalog_id: row.get(8)?,
                catalog_name: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("Chyba při čtení skenu: {}", e))?);
    }
    Ok(result)
}

#[tauri::command]
pub fn get_database_path(app: tauri::AppHandle) -> Result<String, String> {
    let path = db::get_db_path(&app)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_media_scan(app: tauri::AppHandle, id: String) -> Result<Option<MediaScanInfo>, String> {
    let db_path = db::get_db_path(&app)?;
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;
    let result = conn.query_row(
        "SELECT m.id, m.serial_number, m.label, m.drive_path, m.scan_completed_at,
                m.file_count, m.total_size_bytes, COALESCE(m.is_favorite, 0) as is_favorite,
                m.catalog_id, c.name as catalog_name
         FROM media_scans m
         LEFT JOIN catalogs c ON m.catalog_id = c.id
         WHERE m.id = ?1
         LIMIT 1",
        rusqlite::params![id],
        |row| {
            Ok(MediaScanInfo {
                id: row.get(0)?,
                serial_number: row.get(1)?,
                label: row.get(2)?,
                drive_path: row.get(3)?,
                scan_completed_at: row.get(4)?,
                file_count: row.get(5)?,
                total_size_bytes: row.get(6)?,
                is_favorite: row.get(7)?,
                catalog_id: row.get(8)?,
                catalog_name: row.get(9)?,
            })
        },
    );
    match result {
        Ok(scan) => Ok(Some(scan)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Nelze načíst sken: {}", e)),
    }
}

#[tauri::command]
pub fn get_catalog_stats(app: tauri::AppHandle) -> Result<CatalogStats, String> {
    let db_path = db::get_db_path(&app)?;
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Nelze otevřít databázi: {}", e))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(15));
    // Agregace z media_scans (stovky řádků) – ne full scan file_entries (stovky tisíc).
    let catalogs_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM catalogs", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let (scans_count, total_files, total_bytes): (i64, i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(file_count), 0), COALESCE(SUM(total_size_bytes), 0)
             FROM media_scans",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok(CatalogStats {
        catalogs_count,
        scans_count,
        total_files,
        total_bytes,
    })
}
