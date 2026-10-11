"use client";

import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save, message, confirm } from "@tauri-apps/plugin-dialog";
import {
  Folder,
  FolderOpen,
  HardDrive,
  Plus,
  PencilSimple,
  Trash,
  DotsThree,
  Book,
  Disc,
  CaretDown,
  CaretRight,
  MagnifyingGlass,
  Star,
  SlidersHorizontal,
  Folders,
  ListBullets,
  DownloadSimple,
  Export,
  FloppyDisk,
  Power,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CatalogCreateDialog, CatalogEditDialog, type Catalog } from "./CatalogDialog";
import { ThemeToggle } from "./ThemeToggle";
import type { MediaScan } from "./CDListItem";

type ScanWithCatalog = MediaScan & { catalog_id: string | null };
type ScanSortBy = "name" | "serial";
type ScanViewMode = "catalogs" | "all";

const DRAG_TYPE_SCAN = "application/x-media-catalog-scan";
const DATABASE_SAVE_PATH_KEY = "media-catalog-database-save-path";
const SCAN_VIEW_MODE_KEY = "media-catalog-scan-view-mode";
const SCAN_SORT_BY_KEY = "media-catalog-scan-sort-by";
const EXPANDED_CATALOGS_KEY = "media-catalog-expanded-catalogs-v2";

const ICON_MAP: Record<string, typeof Folder> = {
  root: Folder,
  "cat-work": FolderOpen,
  "cat-photos": Folder,
  "cat-backups": HardDrive,
};

function getIcon(id: string) {
  return ICON_MAP[id] || Folder;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function refreshScanReport(result: {
  serial_number: string;
  file_count: number;
  total_size_bytes: number;
}): string {
  return [
    "Sken byl úspěšně aktualizován.",
    "",
    `Číslo disku: ${result.serial_number}`,
    `Souborů: ${result.file_count.toLocaleString("cs-CZ")}`,
    `Velikost: ${formatSize(result.total_size_bytes)}`,
  ].join("\n");
}

function readStoredViewMode(): ScanViewMode {
  if (typeof window === "undefined") return "catalogs";
  const raw = window.localStorage.getItem(SCAN_VIEW_MODE_KEY);
  return raw === "all" || raw === "catalogs" ? raw : "catalogs";
}

function readStoredSortBy(): ScanSortBy {
  if (typeof window === "undefined") return "name";
  const raw = window.localStorage.getItem(SCAN_SORT_BY_KEY);
  return raw === "serial" || raw === "name" ? raw : "name";
}

function readStoredExpanded(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(EXPANDED_CATALOGS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function AppSidebar({
  selectedCatalogId,
  selectedScanId,
  onCatalogSelect,
  refreshTrigger,
  optimisticDeletedIds = new Set(),
  onScansChange,
  onDatabaseImported,
  onScanSelect,
  onOpenEdit,
  onOpenDelete,
}: {
  selectedCatalogId?: string;
  selectedScanId?: string | null;
  onCatalogSelect?: (id: string) => void;
  refreshTrigger?: number;
  optimisticDeletedIds?: Set<string>;
  onScansChange?: () => void;
  onDatabaseImported?: () => void;
  onScanSelect?: (scan: import("./CDListItem").MediaScan) => void;
  onOpenEdit?: (scan: import("./CDListItem").MediaScan) => void;
  onOpenDelete?: (scan: import("./CDListItem").MediaScan) => void;
}) {
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [scans, setScans] = useState<ScanWithCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => readStoredExpanded());

  const [createOpen, setCreateOpen] = useState(false);
  const [editCatalog, setEditCatalog] = useState<Catalog | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteCatalog, setDeleteCatalog] = useState<Catalog | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dragOverCatalogId, setDragOverCatalogId] = useState<string | null>(null);
  const [scanSortBy, setScanSortBy] = useState<ScanSortBy>(() => readStoredSortBy());
  const [scanViewMode, setScanViewMode] = useState<ScanViewMode>(() => readStoredViewMode());
  const [dbActionBusy, setDbActionBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<{ title: string; body: string } | null>(null);

  const getScanTitle = (scan: ScanWithCatalog) => {
    const label = (scan.label ?? "").trim();
    return label ? `${label} (${scan.serial_number})` : scan.serial_number;
  };

  const sortScans = (list: ScanWithCatalog[]) => {
    return [...list].sort((a, b) => {
      if (scanSortBy === "serial") {
        return a.serial_number.localeCompare(b.serial_number, "cs", {
          numeric: true,
          sensitivity: "base",
        });
      }
      const aLabel = (a.label ?? "").trim();
      const bLabel = (b.label ?? "").trim();
      const aName = aLabel || a.serial_number;
      const bName = bLabel || b.serial_number;
      const byName = aName.localeCompare(bName, "cs", {
        numeric: true,
        sensitivity: "base",
      });
      if (byName !== 0) return byName;
      return a.serial_number.localeCompare(b.serial_number, "cs", {
        numeric: true,
        sensitivity: "base",
      });
    });
  };

  async function handleMoveToCatalog(
    scanId: string,
    sourceCatalogId: string,
    targetCatalogId: string
  ) {
    if (sourceCatalogId === targetCatalogId) return;
    try {
      await invoke("move_scan_to_catalog", { scanId, catalogId: targetCatalogId });
      loadData();
      onScansChange?.();
    } catch (err) {
      console.error("Move failed:", err);
    } finally {
      setDragOverCatalogId(null);
    }
  }

  async function loadData() {
    setLoading(true);
    setLoadError(null);
    try {
      const hasTauri =
        typeof window !== "undefined" &&
        !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      if (!hasTauri) {
        setCatalogs([]);
        setScans([]);
        setLoadError(
          "Prohlížeč nemá přístup k backendu. Spusťte desktop aplikaci: npx tauri dev"
        );
        return;
      }

      const [catResult, scanResult, dbPathResult] = await Promise.allSettled([
        invoke<Catalog[]>("list_catalogs"),
        invoke<ScanWithCatalog[]>("list_media_scans"),
        invoke<string>("get_database_path"),
      ]);

      const errors: string[] = [];

      if (catResult.status === "fulfilled") {
        setCatalogs(catResult.value);
      } else {
        console.error("Failed to load catalogs:", catResult.reason);
        errors.push(`Katalogy: ${String(catResult.reason)}`);
      }

      let loadedScans: ScanWithCatalog[] = [];
      if (scanResult.status === "fulfilled") {
        loadedScans = scanResult.value;
        setScans(loadedScans);
      } else {
        console.error("Failed to load scans:", scanResult.reason);
        errors.push(`Skeny: ${String(scanResult.reason)}`);
      }

      if (dbPathResult.status === "fulfilled") {
        console.info("Media Catalog DB:", dbPathResult.value);
      }

      if (errors.length) {
        setLoadError(errors.join(" · "));
      }
    } catch (err) {
      console.error("Failed to load sidebar data:", err);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SCAN_VIEW_MODE_KEY, scanViewMode);
  }, [scanViewMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SCAN_SORT_BY_KEY, scanSortBy);
  }, [scanSortBy]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      EXPANDED_CATALOGS_KEY,
      JSON.stringify(Array.from(expanded))
    );
  }, [expanded]);

  const visibleScans = useMemo(
    () => scans.filter((s) => !optimisticDeletedIds.has(s.id)),
    [scans, optimisticDeletedIds]
  );

  const grouped = useMemo(() => {
    const byCatalog = new Map<string, ScanWithCatalog[]>();
    for (const scan of visibleScans) {
      const key = scan.catalog_id ?? "root";
      if (!byCatalog.has(key)) byCatalog.set(key, []);
      byCatalog.get(key)!.push(scan);
    }
    return byCatalog;
  }, [visibleScans]);

  const favoriteScans = useMemo(
    () => visibleScans.filter((s) => s.is_favorite),
    [visibleScans]
  );

  const sortedFilteredFavoriteScans = useMemo(
    () => sortScans(favoriteScans),
    [favoriteScans, scanSortBy]
  );

  const sortedAllScans = useMemo(
    () => sortScans(visibleScans),
    [visibleScans, scanSortBy]
  );

  async function handleToggleFavorite(scan: ScanWithCatalog) {
    try {
      await invoke("toggle_favorite", { id: scan.id });
      loadData();
      onScansChange?.();
    } catch (err) {
      console.error("Toggle favorite failed:", err);
    }
  }

  async function handleRefreshScan(scan: ScanWithCatalog) {
    try {
      const selected = await open({
        directory: true,
        title: "Vyberte médium/složku pro aktualizaci skenu",
      });
      const sourcePath = Array.isArray(selected) ? selected[0] : selected;
      if (!sourcePath) return;
      const result = await invoke<{
        serial_number: string;
        file_count: number;
        total_size_bytes: number;
      }>("refresh_media_scan", { id: scan.id, sourcePath });
      loadData();
      onScansChange?.();
      setSuccessNotice({
        title: "Sken aktualizován",
        body: refreshScanReport(result),
      });
    } catch (err) {
      await message(
        err instanceof Error ? err.message : "Aktualizace skenu selhala.",
        { title: "Media Catalog", kind: "error" }
      );
    }
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCatalogClick = (id: string) => {
    setExpanded((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    onCatalogSelect?.(id);
  };

  async function handleDeleteCatalog() {
    if (!deleteCatalog) return;
    try {
      await invoke("delete_catalog", { id: deleteCatalog.id });
      loadData();
      onScansChange?.();
      setDeleteOpen(false);
      setDeleteCatalog(null);
    } catch (err) {
      console.error("Delete catalog failed:", err);
    }
  }

  function readSavedDatabasePath(): string | null {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(DATABASE_SAVE_PATH_KEY);
    return stored && stored.trim() ? stored : null;
  }

  function rememberDatabasePath(path: string) {
    window.localStorage.setItem(DATABASE_SAVE_PATH_KEY, path);
  }

  async function writeDatabaseCopy(targetPath: string) {
    const savedPath = await invoke<string>("export_database", { targetPath });
    rememberDatabasePath(savedPath);
    return savedPath;
  }

  async function handleSaveDatabaseAs() {
    const date = new Date().toISOString().slice(0, 10);
    const defaultPath = readSavedDatabasePath() ?? `media_catalog_backup_${date}.db`;
    try {
      setDbActionBusy(true);
      const targetPath = await save({
        defaultPath,
        title: "Uložit databázi jako",
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      });
      if (!targetPath) return;
      const savedPath = await writeDatabaseCopy(targetPath);
      setSuccessNotice({
        title: "Databáze uložena",
        body: `Databáze byla úspěšně uložena.\n\nSoubor:\n${savedPath}`,
      });
    } catch (err) {
      await message(
        err instanceof Error ? err.message : "Uložení databáze selhalo.",
        { title: "Media Catalog", kind: "error" }
      );
    } finally {
      setDbActionBusy(false);
    }
  }

  async function handleSaveDatabase() {
    const existing = readSavedDatabasePath();
    if (!existing) {
      await handleSaveDatabaseAs();
      return;
    }
    try {
      setDbActionBusy(true);
      const savedPath = await writeDatabaseCopy(existing);
      setSuccessNotice({
        title: "Databáze uložena",
        body: `Databáze byla úspěšně uložena.\n\nSoubor:\n${savedPath}`,
      });
    } catch (err) {
      await message(
        err instanceof Error ? err.message : "Uložení databáze selhalo.",
        { title: "Media Catalog", kind: "error" }
      );
    } finally {
      setDbActionBusy(false);
    }
  }

  async function handleImportDatabase() {
    try {
      setDbActionBusy(true);
      const selected = await open({
        title: "Vyberte zálohu databáze",
        multiple: false,
        filters: [{ name: "SQLite Database", extensions: ["db", "sqlite", "sqlite3"] }],
      });
      const sourcePath = Array.isArray(selected) ? selected[0] : selected;
      if (!sourcePath) return;
      const shouldImport = await confirm(
        "Import přepíše všechna aktuální data katalogu (katalogy, skeny i soubory). Chcete pokračovat?",
        {
          title: "Potvrdit import databáze",
          kind: "warning",
          okLabel: "Importovat a přepsat",
          cancelLabel: "Zrušit",
        }
      );
      if (!shouldImport) return;
      await invoke("import_database", { sourcePath });
      await message("Databáze byla úspěšně importována.", "Media Catalog");
      loadData();
      onScansChange?.();
      onDatabaseImported?.();
    } catch (err) {
      await message(
        err instanceof Error ? err.message : "Import databáze selhal.",
        { title: "Media Catalog", kind: "error" }
      );
    } finally {
      setDbActionBusy(false);
    }
  }

  async function handleQuitApp() {
    try {
      await invoke("quit_application");
    } catch (err) {
      await message(
        err instanceof Error ? err.message : "Aplikaci se nepodařilo ukončit.",
        { title: "Media Catalog", kind: "error" }
      );
    }
  }

  return (
    <>
      <Sidebar className="border-r border-sidebar-border">
        <SidebarHeader className="border-b border-sidebar-border px-4 h-[72px] justify-center">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-highlight text-highlight-foreground">
                <Book size={18} weight="fill" />
              </div>
              <h2 className="text-base font-semibold tracking-tight truncate">Media Catalog</h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Menu aplikace">
                    <DotsThree size={16} weight="bold" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={handleSaveDatabase} disabled={dbActionBusy}>
                    <FloppyDisk size={14} />
                    Uložit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleSaveDatabaseAs} disabled={dbActionBusy}>
                    <Export size={14} />
                    Uložit jako
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleImportDatabase} disabled={dbActionBusy}>
                    <DownloadSimple size={14} />
                    Importovat databázi
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={handleQuitApp}>
                    <Power size={14} />
                    Ukončit aplikaci
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="gap-4 overflow-hidden">
          <SidebarGroup className="flex-1 min-h-0">
            <div className="flex items-center justify-between gap-2 px-2">
              <SidebarGroupLabel>Katalogy</SidebarGroupLabel>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => setCreateOpen(true)}
                aria-label="Přidat katalog"
              >
                <Plus size={16} weight="bold" />
              </Button>
            </div>
            <div className="px-2 pb-2">
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 flex-1 justify-between text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        <SlidersHorizontal size={14} />
                        Řazení položek
                      </span>
                      <span className="text-muted-foreground">
                        {scanSortBy === "name" ? "Název" : "Číslo disku"}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel>Řadit podle</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={scanSortBy}
                      onValueChange={(v) => setScanSortBy(v as ScanSortBy)}
                    >
                      <DropdownMenuRadioItem value="name">Název</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="serial">Číslo disku</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant={scanViewMode === "catalogs" ? "default" : "outline"}
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={() => setScanViewMode("catalogs")}
                  title="Zobrazení podle katalogů"
                  aria-label="Zobrazení podle katalogů"
                >
                  <Folders size={16} weight={scanViewMode === "catalogs" ? "fill" : "regular"} />
                </Button>
                <Button
                  variant={scanViewMode === "all" ? "default" : "outline"}
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={() => setScanViewMode("all")}
                  title="Zobrazení všech skenů"
                  aria-label="Zobrazení všech skenů"
                >
                  <ListBullets size={16} weight={scanViewMode === "all" ? "fill" : "regular"} />
                </Button>
              </div>
            </div>
            <div className="space-y-0.5 overflow-y-auto flex-1 min-h-0 [scrollbar-color:var(--sidebar-accent)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-sidebar-accent/70 hover:[&::-webkit-scrollbar-thumb]:bg-sidebar-accent">
              {loadError && (
                <div className="mx-1 mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-2 text-xs text-destructive">
                  Načtení katalogu selhalo: {loadError}
                </div>
              )}
              {loading ? (
                <div className="flex items-center gap-2 px-2 py-6 text-xs text-muted-foreground">
                  <MagnifyingGlass size={14} className="animate-pulse shrink-0" />
                  Načítání...
                </div>
              ) : catalogs.length === 0 && scans.length === 0 ? (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  Zatím žádné skeny. Provedením nového skenu přidáte položky.
                </div>
              ) : (
                <>
                  {/* Oblíbené */}
                  <div className="rounded-md overflow-hidden transition-colors">
                    <div className="flex items-center group/cat">
                      <button
                        type="button"
                        className={`flex flex-1 min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                          selectedCatalogId === "favorites" ? "bg-card font-medium shadow-sm" : ""
                        }`}
                        onClick={() => handleCatalogClick("favorites")}
                      >
                        {favoriteScans.length > 0 ? (
                          <span
                            role="button"
                            tabIndex={-1}
                            aria-label={expanded.has("favorites") ? "Sbalit" : "Rozbalit"}
                            className="inline-flex shrink-0"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleExpand("favorites");
                            }}
                          >
                            {expanded.has("favorites") ? (
                              <CaretDown size={14} className="text-muted-foreground" />
                            ) : (
                              <CaretRight size={14} className="text-muted-foreground" />
                            )}
                          </span>
                        ) : (
                          <span className="w-3.5 shrink-0" />
                        )}
                        <Star size={16} weight="regular" className="shrink-0 text-amber-500" />
                        <span className="truncate flex-1">Oblíbené</span>
                        {favoriteScans.length > 0 && (
                          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                            {favoriteScans.length}
                          </span>
                        )}
                      </button>
                    </div>
                    {expanded.has("favorites") && favoriteScans.length > 0 && (
                      <div className="ml-4 border-l border-sidebar-border pl-1.5 py-0.5 space-y-0.5">
                        {sortedFilteredFavoriteScans.map((scan) => {
                          const displayName = getScanTitle(scan);
                          const sourceCatalogId = scan.catalog_id ?? "root";
                          return (
                            <div
                              key={scan.id}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData(
                                  DRAG_TYPE_SCAN,
                                  JSON.stringify({ scanId: scan.id, catalogId: sourceCatalogId })
                                );
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
                              }}
                              className={`group/row flex items-center gap-2 rounded px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing ${
                                selectedScanId === scan.id
                                  ? "bg-card text-foreground shadow-sm"
                                  : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                              }`}
                              onClick={() => onScanSelect?.(scan)}
                            >
                              <Disc size={14} weight="fill" className="shrink-0 text-muted-foreground" />
                              <span className="truncate flex-1 min-w-0 font-medium">{displayName}</span>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-5 shrink-0 opacity-0 group-hover/row:opacity-100"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <DotsThree size={12} weight="bold" />
                                    <span className="sr-only">Menu</span>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onScanSelect?.(scan);
                                    }}
                                  >
                                    Zobrazit detail
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRefreshScan(scan);
                                    }}
                                  >
                                    Aktualizovat sken
                                  </DropdownMenuItem>
                                  <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>Přesunout do katalogu</DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent>
                                      {catalogs
                                        .filter((cat) => cat.id !== (scan.catalog_id ?? "root"))
                                        .map((cat) => (
                                          <DropdownMenuItem
                                            key={cat.id}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleMoveToCatalog(scan.id, scan.catalog_id ?? "root", cat.id);
                                            }}
                                          >
                                            {cat.name}
                                          </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuSubContent>
                                  </DropdownMenuSub>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleFavorite(scan);
                                    }}
                                  >
                                    {scan.is_favorite ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onOpenEdit?.(scan);
                                    }}
                                  >
                                    Upravit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onOpenDelete?.(scan);
                                    }}
                                  >
                                    Odebrat
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {scanViewMode === "all" ? (
                    <div className="rounded-md overflow-hidden transition-colors">
                      <div className="flex items-center group/cat">
                        <button
                          type="button"
                          className={`flex flex-1 min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                            selectedCatalogId === "all" ? "bg-card font-medium shadow-sm" : ""
                          }`}
                          onClick={() => handleCatalogClick("all")}
                        >
                          {sortedAllScans.length > 0 ? (
                            <span
                              role="button"
                              tabIndex={-1}
                              aria-label={expanded.has("all") ? "Sbalit" : "Rozbalit"}
                              className="inline-flex shrink-0"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleExpand("all");
                              }}
                            >
                              {expanded.has("all") ? (
                                <CaretDown size={14} className="text-muted-foreground" />
                              ) : (
                                <CaretRight size={14} className="text-muted-foreground" />
                              )}
                            </span>
                          ) : (
                            <span className="w-3.5 shrink-0" />
                          )}
                          <Disc size={16} weight="regular" className="shrink-0" />
                          <span className="truncate flex-1">Všechny skeny</span>
                          {sortedAllScans.length > 0 && (
                            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                              {sortedAllScans.length}
                            </span>
                          )}
                        </button>
                      </div>
                      {expanded.has("all") && sortedAllScans.length > 0 && (
                        <div className="ml-4 border-l border-sidebar-border pl-1.5 py-0.5 space-y-0.5">
                          {sortedAllScans.map((scan) => {
                            const displayName = getScanTitle(scan);
                            const sourceCatalogId = scan.catalog_id ?? "root";
                            return (
                              <div
                                key={scan.id}
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData(
                                    DRAG_TYPE_SCAN,
                                    JSON.stringify({ scanId: scan.id, catalogId: sourceCatalogId })
                                  );
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
                                }}
                                className={`group/row flex items-center gap-2 rounded px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing ${
                                  selectedScanId === scan.id
                                    ? "bg-card text-foreground shadow-sm"
                                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                }`}
                                onClick={() => onScanSelect?.(scan)}
                              >
                                <Disc size={14} weight="fill" className="shrink-0 text-muted-foreground" />
                                <span className="truncate flex-1 min-w-0 font-medium">{displayName}</span>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-5 shrink-0 opacity-0 group-hover/row:opacity-100"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <DotsThree size={12} weight="bold" />
                                      <span className="sr-only">Menu</span>
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onScanSelect?.(scan);
                                      }}
                                    >
                                      Zobrazit detail
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRefreshScan(scan);
                                      }}
                                    >
                                      Aktualizovat sken
                                    </DropdownMenuItem>
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger>Přesunout do katalogu</DropdownMenuSubTrigger>
                                      <DropdownMenuSubContent>
                                        {catalogs
                                          .filter((cat) => cat.id !== (scan.catalog_id ?? "root"))
                                          .map((cat) => (
                                            <DropdownMenuItem
                                              key={cat.id}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleMoveToCatalog(scan.id, scan.catalog_id ?? "root", cat.id);
                                              }}
                                            >
                                              {cat.name}
                                            </DropdownMenuItem>
                                          ))}
                                      </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleFavorite(scan);
                                      }}
                                    >
                                      {scan.is_favorite ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenEdit?.(scan);
                                      }}
                                    >
                                      Upravit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenDelete?.(scan);
                                      }}
                                    >
                                      Odebrat
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                  catalogs.map((cat) => {
                  const items = sortScans(grouped.get(cat.id) ?? []);
                  const isOpen = expanded.has(cat.id);
                  const Icon = getIcon(cat.id);
                  const isRoot = cat.id === "root";

                  return (
                    <div
                      key={cat.id}
                      className={`rounded-md overflow-hidden transition-colors ${
                        dragOverCatalogId === cat.id ? "ring-2 ring-primary/50 bg-primary/5" : ""
                      }`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverCatalogId(cat.id);
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          setDragOverCatalogId(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const data = e.dataTransfer.getData(DRAG_TYPE_SCAN);
                        if (data) {
                          try {
                            const { scanId, catalogId } = JSON.parse(data);
                            handleMoveToCatalog(scanId, catalogId, cat.id);
                          } catch {
                            setDragOverCatalogId(null);
                          }
                        } else {
                          setDragOverCatalogId(null);
                        }
                      }}
                    >
                      <div className="flex items-center group/cat">
                        <button
                          type="button"
                          className={`flex flex-1 min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                            selectedCatalogId === cat.id ? "bg-card font-medium shadow-sm" : ""
                          }`}
                          onClick={() => handleCatalogClick(cat.id)}
                        >
                          {items.length > 0 ? (
                            <span
                              role="button"
                              tabIndex={-1}
                              aria-label={isOpen ? "Sbalit" : "Rozbalit"}
                              className="inline-flex shrink-0"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleExpand(cat.id);
                              }}
                            >
                              {isOpen ? (
                                <CaretDown size={14} className="text-muted-foreground" />
                              ) : (
                                <CaretRight size={14} className="text-muted-foreground" />
                              )}
                            </span>
                          ) : (
                            <span className="w-3.5 shrink-0" />
                          )}
                          <Icon size={16} weight="regular" className="shrink-0" />
                          <span className="truncate flex-1">{cat.name}</span>
                          {items.length > 0 && (
                            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                              {items.length}
                            </span>
                          )}
                        </button>
                        {!isRoot && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 opacity-0 group-hover/cat:opacity-100 shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <DotsThree size={14} weight="bold" />
                                <span className="sr-only">Menu katalogu</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditCatalog(cat);
                                  setEditOpen(true);
                                }}
                              >
                                <PencilSimple size={14} className="mr-2" />
                                Upravit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => {
                                  setDeleteCatalog(cat);
                                  setDeleteOpen(true);
                                }}
                              >
                                <Trash size={14} className="mr-2" />
                                Smazat
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                      {isOpen && items.length > 0 && (
                        <div className="ml-4 border-l border-sidebar-border pl-1.5 py-0.5 space-y-0.5">
                          {items.map((scan) => {
                            const displayName = getScanTitle(scan);
                            const sourceCatalogId = scan.catalog_id ?? "root";
                            return (
                              <div
                                key={scan.id}
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData(
                                    DRAG_TYPE_SCAN,
                                    JSON.stringify({ scanId: scan.id, catalogId: sourceCatalogId })
                                  );
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
                                }}
                                className={`group/row flex items-center gap-2 rounded px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing ${
                                  selectedScanId === scan.id
                                    ? "bg-card text-foreground shadow-sm"
                                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                }`}
                                onClick={() => onScanSelect?.(scan)}
                              >
                                <Disc size={14} weight="fill" className="shrink-0 text-muted-foreground" />
                                <span className="truncate flex-1 min-w-0 font-medium">{displayName}</span>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-5 shrink-0 opacity-0 group-hover/row:opacity-100"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <DotsThree size={12} weight="bold" />
                                      <span className="sr-only">Menu</span>
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onScanSelect?.(scan);
                                      }}
                                    >
                                      Zobrazit detail
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRefreshScan(scan);
                                      }}
                                    >
                                      Aktualizovat sken
                                    </DropdownMenuItem>
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger>Přesunout do katalogu</DropdownMenuSubTrigger>
                                      <DropdownMenuSubContent>
                                        {catalogs
                                          .filter((cat) => cat.id !== (scan.catalog_id ?? "root"))
                                          .map((cat) => (
                                            <DropdownMenuItem
                                              key={cat.id}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleMoveToCatalog(scan.id, scan.catalog_id ?? "root", cat.id);
                                              }}
                                            >
                                              {cat.name}
                                            </DropdownMenuItem>
                                          ))}
                                      </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleFavorite(scan);
                                      }}
                                    >
                                      {scan.is_favorite ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenEdit?.(scan);
                                      }}
                                    >
                                      Upravit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenDelete?.(scan);
                                      }}
                                    >
                                      Odebrat
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                  })
                  )}
                </>
              )}
            </div>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <CatalogCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={loadData} />
      <CatalogEditDialog
        catalog={editCatalog}
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditCatalog(null);
        }}
        onSaved={loadData}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat katalog?</AlertDialogTitle>
            <AlertDialogDescription>
              Opravdu chcete smazat katalog „{deleteCatalog?.name}“? Skeny v tomto katalogu budou
              přesunuty do „Vše“.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteCatalog();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Smazat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={successNotice !== null}
        onOpenChange={(open) => {
          if (!open) setSuccessNotice(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{successNotice?.title}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {successNotice?.body}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
}
