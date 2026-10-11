# Changelog

Formát podle [Keep a Changelog](https://keepachangelog.com/cs-CZ/1.1.0/).
Projekt Media Catalog – Tauri 2 + React + SQLite.

---

## [Unreleased]

### Changed

- Složky v panelu Katalogy, včetně Oblíbených, jsou po startu sbalené. Otevřené zůstanou jen ty, které uživatel rozbalí šipkou.
- Během aktualizace skenu je nahoře průběh: počet souborů a žlutý pruh, který se hýbe i když číslo chvíli stojí.
- Aktualizace skenu porovná disk se uloženými soubory. Nezměněné přeskočí, zapíše jen nové nebo změněné a smaže jen ty, které z disku zmizely.
- Po uložení databáze a po aktualizaci skenu se v aplikaci ukáže potvrzení. U skenu je v něm číslo disku, počet souborů a velikost.

### Fixed

- **Aktualizace skenu už nemaže staré soubory přes 2MB cache**
  - Příčina: před čtením disku se smažou všechny řádky skenu. Databáze má stovky tisíc souborů a SQLite držela jen 2 MB v paměti, takže každý řádek sahal na disk. Navíc index `idx_file_entries_name` vyhledávání nepoužívá (`fold_name`) a mazání ho přesto přepisovalo.
  - Sken teď dostane 256 MB cache a nepoužívaný index názvu se zahodí.
- **Aktualizace skenu už nezamrzne okno**
  - Příčina: `refresh_media_scan` běžel na hlavním vlákně, takže se UI nepřekreslilo, dokud neskončil celý průchod USB disku
  - Sken teď běží na pozadí a nahoře ukazuje počet zpracovaných souborů
  - Průchod disku bere metadata z výpisu složky a přeskakuje systémové složky Windows (`System Volume Information`, `$RECYCLE.BIN`)

### Stav k 11. 10. 2026

Hotová verze pro portfolio: [Media-Catalog](https://github.com/merakiolab-cyber/Media-Catalog).

- Sken disku nebo složky, strom katalogů, detail souborů, oblíbené
- Fulltext v pravém okně pod přehledem; řazení podle názvu a typu; klik rozbalí cestu a ukáže konkrétní soubor
- Menu: `Uložit`, `Uložit jako`, import s potvrzením, ukončení aplikace
- Světlý vzhled (šedé plátno, bílé karty, žlutý akcent); tmavý režim ve stejné struktuře
- Pracovní databáze jen lokálně v `CDMediacatalog/` (do gitu nepatří)
- Produkční soubor: `src-tauri/target/release/media-catalog.exe` přes `npm run tauri:build`

### Added

- **Fulltext přes celý katalog**
  - Pole v pravém okně hledá názvy souborů a složek ve všech skenech (`search_catalog_files`)
  - Výsledky (obrázky, složky i ostatní soubory) se vypisují v hlavním panelu včetně disku a cesty
  - Kliknutí otevře daný sken, rozbalí cestu a zvýrazní přímo ten soubor nebo složku
  - Výsledky jde řadit podle názvu nebo typu souboru
  - Vyhledávání je v pravém okně pod přehledem katalogu, ne v postranním stromu
  - Shoda ignoruje velikost písmen a českou diakritiku (`Hájek` = `hajek`)
- **Aktualizace existující položky skenu**
  - Nový Tauri command `refresh_media_scan`
  - Před aktualizací je povinný výběr zdrojového média/složky
  - Po refresh se přepíše obsah položky i `drive_path`
- **Automatické otevření detailu po skenu**
  - Po dokončení nového skenu se automaticky otevře detail právě naskenované položky
- **Aplikace menu v sidebar headeru**
  - Přesun akcí `Importovat databázi` a `Exportovat databázi` do menu u názvu Media Catalog
  - Přidána akce `Ukončit aplikaci` (`quit_application`)
- **Refresh jednotek ve ScannerPanel**
  - Tlačítko `Refresh` pro znovunačtení CD-ROM a disků bez restartu aplikace
- **Uložení databáze**
  - Menu `Uložit` zapíše kopii do poslední zvolené cesty
  - `Uložit jako` otevře dialog a cestu si pamatuje
  - Když ještě žádná cesta není, `Uložit` se chová jako `Uložit jako`
- **Potvrzovací dialog před importem**
  - Import je destruktivní akce (přepisuje katalogy, skeny i soubory)
  - Uživatel musí import explicitně potvrdit

### Changed

- **Vzhled podle světlého dashboardu**
  - Teplé šedé plátno, bílé plovoucí karty, výraznější zaoblení
  - Žlutý akcent na značkách a průběhu, hlavní tlačítka zůstávají tmavá
  - Přehled katalogu je řada karet s popiskem a velkým číslem
- **Příprava na veřejné repo**
  - Identifikátor aplikace už neobsahuje osobní jméno
  - `CDMediacatalog/` (osobní databáze a zálohy) je celé v `.gitignore`
  - README má náhled aplikace
- **Dokumentace pro další vývoj**
  - `.cursor/rules/lessons-learned.mdc` – pasti (DB, build, race, testování)
  - Aktualizovány `CHANGELOG` poznámky, `AGENTS.md`, `README.md`, `.cursorrules`
  - Odstraněny debug logy a nepoužívané UI vzorky (`CatalogItemSample`, `CDDetailDialog`)
- **Umístění databáze**
  - Aktivní DB je nyní `CDMediacatalog/media_catalog.db` (vedle kořene projektu)
  - Při prvním startu se preferuje nejnovější `media_catalog_backup_*.db` (ne AppData)
  - Frontend čte/zapisuje přes rusqlite commandy (`list_media_scans`, `get_media_scan`, `get_catalog_stats`, …) místo `tauri-plugin-sql`
- **UI vylepšení**
  - `AppSidebar`: ikonové přepínače režimu zobrazení (`Katalogy` / `Všechny skeny`) v jednom řádku s řazením
  - Aktivně vybraný sken je vizuálně zvýrazněný v levém menu
  - Do menu položky přidána akce `Aktualizovat sken`
  - Z menu položky odstraněna ikonka hvězdičky u oblíbených
  - Header menu (`...`) přesunuto hned za text `Media Catalog`
- **Detail položky**
  - Search vpravo, řazení vlevo
  - Metadata sjednocena do jednoho řádku (číslo disku, rok vytvoření, cesta, soubory/velikost)
  - Název položky formátován jako `Název (číslo disku)`
  - Ve výpisu souborů se zobrazuje `velikost · datum`
- **ScannerPanel**
  - Odebrány pomocné vysvětlivky pod poli
  - V sekci „Ostatní zdroje“ nahrazeny CD ikony za diskové

### Fixed

- **Start aplikace – chybějící katalog a položky**
  - Obnovení posledního vybraného katalogu, režimu zobrazení, řazení a rozbalení ze `localStorage`
  - Po načtení dat se automaticky rozbalí vybraný katalog (položky jsou hned vidět)
  - Katalog „Vše“ (`root`) je opět viditelný ve stromu – nové skeny tam defaultně končí
  - Načítání sidebaru: katalogy a skeny se načítají nezávisle (`Promise.allSettled`)
- **Nestabilní start (race DB)**
  - Inicializace DB cesty je jednorázová (`OnceLock` + mutex), bez paralelních migrací
  - Přehled katalogu počítá statistiky z `media_scans` (ne full scan `file_entries`)
- **Produkční `.exe` a localhost**
  - Release se musí stavět přes `npm run tauri:build` / `npx tauri build` (ne samotný `cargo build --release`)
- **Export databáze**: opraven WAL checkpoint v `export_database`
  - `PRAGMA wal_checkpoint(TRUNCATE)` je nyní voláno přes `query_row(...)` místo `execute(...)`
  - Oprava chyby: „Execute returned results - did you mean to call query?“
- **Sbalení složky v katalogu**
  - Šipka jen přepíná rozbalení a už nespouští znovuotevření vybraného katalogu
  - První klik složku sbalí
- **Scroll chování**
  - Opraveno dvojité scrollování v sidebaru
  - Scroll v detailu položky je omezen na okno výpisu složek/souborů
  - Scrollbar v sidebaru i výpisu složek je stylovaný v barvách aplikace

---

## [0.1.0] - 2025-02-17

### Added

- **Správa katalogů v sidebaru**
  - Načítání katalogů z DB přes `list_catalogs`
  - Tlačítko „Přidat katalog“ (+) vedle nadpisu „Katalogy“
  - Kontextové menu u každého katalogu (kromě „Vše“): Upravit, Smazat
  - `CatalogCreateDialog` – vytvoření nového katalogu
  - `CatalogEditDialog` – úprava názvu katalogu
  - `AlertDialog` – potvrzení smazání katalogu (skeny se přesouvají do „Vše“)

### Fixed

- **CatalogDialog**: parametr `parent_id` místo `parentId` pro Rust API `create_catalog`
- **Vytváření katalogu v prohlížeči**: Místo tiché nečinnosti se zobrazí chybová hláška:
  - „Prohlížeč nemá přístup k backendu. Spusťte desktop aplikaci: npx tauri dev (vyžaduje Rust: rustup.rs)“
  - Příčina: `invoke` vyžaduje Tauri runtime (`window.__TAURI_INTERNALS__`); v čistém prohlížeči (`npm run dev`) backend není dostupný

### Changed

- `AppSidebar`: přepracován – dynamický seznam katalogů z DB místo hardcoded položek
- Ikony katalogů: root (Folder), cat-work (FolderOpen), cat-photos (Folder), cat-backups (HardDrive)

---

## Poznámky pro vývoj

Agent rules: `.cursorrules`, `.cursor/rules/lessons-learned.mdc`, `AGENTS.md`.

### Spuštění a build

| Režim | Příkaz | Popis |
|-------|--------|-------|
| **Prohlížeč (UI)** | `npm run dev` | Vite only – `invoke` nefunguje |
| **Desktop (dev)** | `npm run tauri:dev` | Tauri + Rust backend |
| **Produkční `.exe`** | `npm run tauri:build` | Jediný správný release build |

`cargo build --release` samotný → `.exe` na `localhost:1420` → `ERR_CONNECTION_REFUSED`.

### Databáze

- Aktivní: `CDMediacatalog/media_catalog.db` (ne AppData)
- Seed: nejnovější `media_catalog_backup_*.db`, pak legacy AppData
- Init: `db::ensure_database` – `OnceLock` + mutex (bez paralelních migrací)
- Stats: z agregátů `media_scans`, ne full scan `file_entries`
- Access: rusqlite `invoke` (`list_media_scans`, `get_catalog_stats`, …)
- Kopie ven: `Uložit` / `Uložit jako` přes `export_database`; poslední cesta je v `localStorage` (`media-catalog-database-save-path`)

### Klíčové soubory

- `src/components/AppSidebar.tsx` – katalogy, skeny, uložit / uložit jako / import
- `src/components/CDDetailPanel.tsx` – detail skenu (panel, ne dialog)
- `src/components/CatalogDashboard.tsx` – přehled statistik
- `src-tauri/src/db.rs` – cesta DB, seed, migrace rusqlite
- `src-tauri/src/commands.rs` – všechny Tauri commandy
- `src-tauri/migrations/` – SQL migrace (jen přidávat, neměnit zpětně)

### DB schéma

```
catalogs: id, parent_id, name, created_at
  - root (Vše) – neměnitelný, default cíl nových skenů
media_scans: … file_count, total_size_bytes, is_favorite, media_fingerprint
file_entries: … path, full_path, name, is_directory, size_bytes, parent_id
```

### Lessons learned (stručně)

| Symptom | Příčina / fix |
|---------|----------------|
| Invoke error v Cursor preview | Chybí Tauri runtime → `tauri:dev` |
| `.exe` connection refused | Build přes `tauri:build`, ne `cargo release` |
| Sidebar XOR dashboard prázdný | Race `ensure_database` / pomalé COUNT `file_entries` |
| Prázdný katalog po přesunu dat | Číst `CDMediacatalog`, ne AppData |
| Export wal_checkpoint chyba | `query_row`, ne `execute` |
