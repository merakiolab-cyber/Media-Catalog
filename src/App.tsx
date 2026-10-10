import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Disc } from "@phosphor-icons/react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ScannerPanel } from "@/components/ScannerPanel";
import { SearchInput } from "@/components/SearchInput";
import { CatalogDashboard } from "@/components/CatalogDashboard";
import { CatalogSearchResults, hitToScan, type CatalogFileHit } from "@/components/CatalogSearchResults";
import { CDDetailPanel } from "@/components/CDDetailPanel";
import { CDEditDialog } from "@/components/CDEditDialog";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import type { MediaScan } from "@/components/CDListItem";

function App() {
  const SIDEBAR_WIDTH_KEY = "media-catalog-sidebar-width";
  const MIN_SIDEBAR_WIDTH = 220;
  const MAX_SIDEBAR_WIDTH = 420;
  const panelLayout = useDefaultLayout({
    id: "media-catalog-detail-main-v2",
    panelIds: ["detail", "main"],
    storage: typeof window !== "undefined" ? localStorage : undefined,
  });
  const SELECTED_CATALOG_KEY = "media-catalog-selected-catalog";
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>(() => {
    if (typeof window === "undefined") return "root";
    return window.localStorage.getItem(SELECTED_CATALOG_KEY) ?? "root";
  });
  const [selectedScan, setSelectedScan] = useState<MediaScan | null>(null);
  const [editScan, setEditScan] = useState<MediaScan | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteScan, setDeleteScan] = useState<MediaScan | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [optimisticDeletedIds, setOptimisticDeletedIds] = useState<Set<string>>(new Set());
  const [catalogQuery, setCatalogQuery] = useState("");
  const [focusEntry, setFocusEntry] = useState<{ path: string; isDirectory: boolean } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 256;
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed)) return 256;
    return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed));
  });
  const scannerRef = useRef<HTMLDivElement>(null);

  const refresh = () => setRefreshTrigger((n) => n + 1);
  const markDeleted = (id: string) => setOptimisticDeletedIds((s) => new Set(s).add(id));
  const unmarkDeleted = (id: string) => setOptimisticDeletedIds((s) => {
    const next = new Set(s); next.delete(id); return next;
  });

  useEffect(() => {
    const handler = () => {
      scannerRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    window.addEventListener("media-catalog:new-scan", handler);
    return () => window.removeEventListener("media-catalog:new-scan", handler);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SELECTED_CATALOG_KEY, selectedCatalogId);
  }, [selectedCatalogId]);

  const startSidebarResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const onMove = (e: MouseEvent) => {
      const nextWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
      setSidebarWidth(nextWidth);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  async function handleScanComplete(scanId: string) {
    refresh();
    try {
      const scan = await invoke<(MediaScan & { catalog_id: string | null }) | null>(
        "get_media_scan",
        { id: scanId }
      );
      if (!scan) return;
      setSelectedCatalogId(scan.catalog_id ?? "root");
      setSelectedScan({
        ...scan,
        scan_completed_at: scan.scan_completed_at ?? 0,
      });
    } catch (err) {
      console.error("Failed to auto-open scanned item detail:", err);
    }
  }

  return (
    <SidebarProvider
      className="h-svh overflow-hidden"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <AppSidebar
        selectedCatalogId={selectedCatalogId}
        selectedScanId={selectedScan?.id ?? null}
        onCatalogSelect={setSelectedCatalogId}
        refreshTrigger={refreshTrigger}
        optimisticDeletedIds={optimisticDeletedIds}
        onScansChange={refresh}
        onDatabaseImported={() => {
          setSelectedScan(null);
          setSelectedCatalogId("root");
          refresh();
        }}
        onScanSelect={(scan) => {
          setFocusEntry(null);
          setSelectedScan(scan);
        }}
        onOpenEdit={(scan) => {
          setEditScan(scan);
          setEditOpen(true);
        }}
        onOpenDelete={(scan) => {
          setDeleteScan(scan);
          setDeleteOpen(true);
        }}
      />
      <div
        role="separator"
        aria-label="Změnit šířku levého panelu"
        aria-orientation="vertical"
        onMouseDown={startSidebarResize}
        className="fixed left-[calc(var(--sidebar-width)-4px)] top-0 z-20 hidden h-svh w-2 cursor-col-resize md:block"
      >
        <div className="mx-auto h-full w-px bg-border/40 transition-colors hover:bg-primary/60" />
      </div>
      <SidebarInset>
        <Group
          orientation="horizontal"
          className="flex flex-1 h-svh min-h-0 overflow-hidden"
          defaultLayout={panelLayout.defaultLayout}
          onLayoutChanged={panelLayout.onLayoutChanged}
        >
          <Panel
            id="detail"
            defaultSize={380}
            minSize={280}
            maxSize={800}
            className="flex flex-col min-h-0"
          >
            <aside className="m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-card shadow-[0_1px_2px_oklch(0_0_0/0.04),0_12px_32px_oklch(0_0_0/0.06)]">
            {selectedScan ? (
              <CDDetailPanel
                scan={selectedScan}
                focusPath={focusEntry?.path ?? null}
                focusIsDirectory={focusEntry?.isDirectory ?? false}
                onClose={() => setSelectedScan(null)}
                onEdit={(scan) => {
                  setEditScan(scan);
                  setEditOpen(true);
                }}
                onDelete={(scan) => {
                  setDeleteScan(scan);
                  setDeleteOpen(true);
                }}
                onFavoriteToggle={(scan) => {
                  refresh();
                  setSelectedScan((prev) =>
                    prev?.id === scan.id
                      ? { ...prev, is_favorite: prev.is_favorite ? 0 : 1 }
                      : prev
                  );
                }}
                onScanUpdated={(scanId, updates) => {
                  refresh();
                  setSelectedScan((prev) =>
                    prev?.id === scanId
                      ? {
                          ...prev,
                          file_count: updates.file_count,
                          total_size_bytes: updates.total_size_bytes,
                          scan_completed_at: updates.scan_completed_at,
                          drive_path: updates.drive_path,
                        }
                      : prev
                  );
                }}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-12 min-h-[280px]">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-highlight text-highlight-foreground">
                  <Disc size={26} weight="fill" />
                </div>
                <p className="text-sm font-medium text-muted-foreground text-center">
                  Vyberte sken pro zobrazení detailu
                </p>
                <p className="text-xs text-muted-foreground text-center max-w-[220px]">
                  Klikněte na položku v katalozích vlevo
                </p>
              </div>
            )}
          </aside>
          </Panel>
          <Separator className="hidden lg:block w-1.5 shrink-0 rounded-full bg-border/50 transition-colors hover:bg-primary/30" />
          <Panel id="main" minSize={30} className="flex flex-col min-w-0 min-h-0">
          <main className="flex min-h-0 flex-1 min-w-0 flex-col overflow-hidden">
            <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-5 px-6 py-6">
              <section className="shrink-0">
                <CatalogDashboard refreshTrigger={refreshTrigger} />
              </section>
              <section className="flex min-h-0 flex-1 flex-col gap-3">
                <SearchInput
                  value={catalogQuery}
                  onChange={setCatalogQuery}
                  placeholder="Hledat soubory a složky v celém katalogu..."
                  inputClassName="h-11 rounded-xl border-transparent bg-card shadow-sm"
                />
                {catalogQuery.trim() ? (
                  <CatalogSearchResults
                    query={catalogQuery}
                    onOpen={(hit: CatalogFileHit) => {
                      setFocusEntry({
                        path: hit.path,
                        isDirectory: hit.is_directory === 1,
                      });
                      setSelectedCatalogId(hit.catalog_id ?? "root");
                      setSelectedScan(hitToScan(hit));
                    }}
                  />
                ) : (
                  <section className="overflow-hidden">
                    <div ref={scannerRef}>
                      <ScannerPanel onScanComplete={handleScanComplete} />
                    </div>
                  </section>
                )}
              </section>
            </div>
          </main>
          </Panel>
        </Group>
      </SidebarInset>

      <CDEditDialog
        scan={editScan}
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditScan(null);
        }}
        onSaved={refresh}
      />
      <DeleteConfirmDialog
        scan={deleteScan}
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) setDeleteScan(null);
        }}
        onConfirmDelete={(scan) => {
          markDeleted(scan.id);
          setDeleteOpen(false);
          setDeleteScan(null);
          setSelectedScan(null);
        }}
        onDeleteSuccess={(scanId) => {
          unmarkDeleted(scanId);
          refresh();
        }}
        onDeleteError={(scanId) => {
          unmarkDeleted(scanId);
          refresh();
        }}
      />
    </SidebarProvider>
  );
}

export default App;
