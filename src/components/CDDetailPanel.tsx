"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CaretDown,
  CaretRight,
  Disc,
  Folder,
  File,
  X,
  PencilSimple,
  Trash,
  Star,
  SpinnerGap,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { SearchInput } from "./SearchInput";
import { invoke } from "@tauri-apps/api/core";
import { open, message } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { MediaScan } from "./CDListItem";

interface FileEntryInfo {
  id: string;
  path: string;
  name: string;
  is_directory: number;
  size_bytes: number | null;
  modified_at?: number | null;
}

type SortBy = "name" | "date" | "type" | "size";
type RefreshScanResult = {
  id: string;
  serial_number: string;
  file_count: number;
  total_size_bytes: number;
};

function getExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

interface TreeNode {
  path: string;
  name: string;
  file?: FileEntryInfo;
  isDirectory: boolean;
  children?: TreeNode[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatFileDate(timestamp?: number | null): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("cs-CZ");
}

function toTreeNode(e: FileEntryInfo): TreeNode {
  const pathNorm = e.path.replace(/\\/g, "/");
  const name = pathNorm.includes("/") ? pathNorm.split("/").pop()! : e.path;
  return {
    path: pathNorm,
    name,
    file: e,
    isDirectory: e.is_directory === 1,
  };
}

type FlatItem = { node: TreeNode; depth: number };

function flattenTree(
  nodes: TreeNode[],
  expanded: Set<string>,
  childrenCache: Map<string, TreeNode[]>,
  useNodeChildren: boolean,
  depth: number,
  out: FlatItem[]
): void {
  for (const node of nodes) {
    out.push({ node, depth });
    const children = useNodeChildren ? node.children : childrenCache.get(node.path);
    const isExpanded = expanded.has(node.path);
    const hasChildren = node.isDirectory && (children?.length || expanded.has(node.path));
    if (hasChildren && isExpanded && children?.length) {
      flattenTree(children, expanded, childrenCache, useNodeChildren, depth + 1, out);
    }
  }
}

const ROW_HEIGHT = 36;

function VirtualizedFolderTree({
  nodes,
  expanded,
  loadingPaths,
  onToggle,
  loadChildren,
  childrenCache,
  useNodeChildren,
  parentRef,
  highlightPath,
}: {
  nodes: TreeNode[];
  expanded: Set<string>;
  loadingPaths: Set<string>;
  onToggle: (path: string) => void;
  loadChildren: (path: string) => void;
  childrenCache: Map<string, TreeNode[]>;
  useNodeChildren?: boolean;
  parentRef: React.RefObject<HTMLDivElement | null>;
  highlightPath?: string | null;
}) {
  const flatItems = useMemo(() => {
    const out: FlatItem[] = [];
    flattenTree(nodes, expanded, childrenCache, !!useNodeChildren, 0, out);
    return out;
  }, [nodes, expanded, childrenCache, useNodeChildren]);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const scrolledPath = useRef<string | null>(null);

  useEffect(() => {
    if (!highlightPath) {
      scrolledPath.current = null;
      return;
    }
    if (scrolledPath.current === highlightPath) return;
    const index = flatItems.findIndex((item) => item.node.path === highlightPath);
    if (index < 0) return;
    scrolledPath.current = highlightPath;
    const frame = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(index, { align: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [highlightPath, flatItems, virtualizer]);

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: "100%",
        position: "relative",
      }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const { node, depth } = flatItems[virtualRow.index];
        const children = useNodeChildren ? node.children : childrenCache.get(node.path);
        const isLoading = loadingPaths.has(node.path);
        const hasChildren = node.isDirectory;
        const isExpanded = expanded.has(node.path);

        return (
          <div
            key={node.path}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <div
              className={cn(
                "flex items-center gap-2 py-2 px-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors min-w-0",
                highlightPath === node.path && "bg-highlight/70 ring-1 ring-inset ring-highlight"
              )}
              style={{ paddingLeft: depth * 16 }}
              onClick={() => {
                if (!hasChildren) return;
                if (!isExpanded) {
                  onToggle(node.path);
                  if (!children && !isLoading) {
                    loadChildren(node.path);
                  }
                } else {
                  onToggle(node.path);
                }
              }}
            >
              <span className="w-4 shrink-0 flex items-center justify-center">
                {hasChildren ? (
                  isLoading && !children?.length ? (
                    <SpinnerGap size={14} weight="bold" className="animate-spin text-muted-foreground" />
                  ) : isExpanded ? (
                    <CaretDown size={14} weight="bold" className="text-muted-foreground" />
                  ) : (
                    <CaretRight size={14} weight="bold" className="text-muted-foreground" />
                  )
                ) : (
                  <span className="w-4" />
                )}
              </span>
              {node.isDirectory ? (
                <Folder size={18} weight="fill" className="text-amber-500 shrink-0" />
              ) : (
                <File size={18} className="text-muted-foreground shrink-0" />
              )}
              <span className="truncate text-sm flex-1">{node.name}</span>
              {!node.isDirectory && (
                <span className="text-xs text-muted-foreground shrink-0 inline-flex items-center gap-1.5">
                  {node.file?.size_bytes != null && node.file.size_bytes > 0 && (
                    <span>{formatSize(node.file.size_bytes)}</span>
                  )}
                  {node.file?.size_bytes != null &&
                    node.file.size_bytes > 0 &&
                    formatFileDate(node.file?.modified_at) && <span>·</span>}
                  {formatFileDate(node.file?.modified_at) && (
                    <span>{formatFileDate(node.file?.modified_at)}</span>
                  )}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function compareNodes(a: TreeNode, b: TreeNode, sortBy: SortBy): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  switch (sortBy) {
    case "name":
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    case "date": {
      const aMod = a.file?.modified_at ?? 0;
      const bMod = b.file?.modified_at ?? 0;
      return bMod - aMod;
    }
    case "type": {
      const aExt = getExtension(a.name);
      const bExt = getExtension(b.name);
      const extCmp = aExt.localeCompare(bExt);
      return extCmp !== 0 ? extCmp : a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    case "size": {
      const aSize = a.file?.size_bytes ?? 0;
      const bSize = b.file?.size_bytes ?? 0;
      if (bSize !== aSize) return bSize - aSize; // largest first
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    default:
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  }
}

function sortTreeNodes(nodes: TreeNode[], sortBy: SortBy): TreeNode[] {
  return [...nodes].sort((a, b) => compareNodes(a, b, sortBy)).map((n) => ({
    ...n,
    children: n.children?.length ? sortTreeNodes(n.children, sortBy) : undefined,
  }));
}

function buildTreeFromEntries(entries: FileEntryInfo[], sortBy: SortBy): TreeNode[] {
  interface NodeWithMap extends TreeNode {
    childMap: Map<string, NodeWithMap>;
  }
  const root: { childMap: Map<string, NodeWithMap> } = { childMap: new Map() };

  for (const e of entries) {
    const pathNorm = e.path.replace(/\\/g, "/");
    const parts = pathNorm.split("/").filter(Boolean);
    let current: { childMap: Map<string, NodeWithMap> } = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const path = parts.slice(0, i + 1).join("/");
      const isLast = i === parts.length - 1;

      if (!current.childMap.has(part)) {
        const node: NodeWithMap = {
          path,
          name: part,
          file: isLast ? e : undefined,
          isDirectory: !isLast || e.is_directory === 1,
          childMap: new Map(),
        };
        current.childMap.set(part, node);
      } else if (isLast) {
        const existing = current.childMap.get(part)!;
        existing.file = e;
        existing.isDirectory = e.is_directory === 1;
      }
      current = current.childMap.get(part)!;
    }
  }

  const sortAndCollect = (childMap: Map<string, NodeWithMap>): TreeNode[] => {
    const arr = Array.from(childMap.values());
    arr.sort((a, b) => compareNodes(a, b, sortBy));
    return arr.map((n) => {
      const kids = sortAndCollect(n.childMap);
      const { childMap: _cm, ...rest } = n;
      return { ...rest, children: kids };
    });
  };

  return sortAndCollect(root.childMap);
}

export function CDDetailPanel({
  scan,
  onClose,
  onEdit,
  onDelete,
  onFavoriteToggle,
  onScanUpdated,
  focusPath,
  focusIsDirectory,
}: {
  scan: MediaScan | null;
  onClose: () => void;
  onEdit: (scan: MediaScan) => void;
  onDelete: (scan: MediaScan) => void;
  onFavoriteToggle?: (scan: MediaScan) => void;
  onScanUpdated?: (scanId: string, updates: { file_count: number; total_size_bytes: number; scan_completed_at: number; drive_path: string }) => void;
  focusPath?: string | null;
  focusIsDirectory?: boolean;
}) {
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [childrenCache, setChildrenCache] = useState<Map<string, TreeNode[]>>(new Map());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [rootLoading, setRootLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntryInfo[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [refreshingScan, setRefreshingScan] = useState(false);
  const [successNotice, setSuccessNotice] = useState<{ title: string; body: string } | null>(null);
  const [latestStats, setLatestStats] = useState<{
    file_count: number;
    total_size_bytes: number;
    scan_completed_at: number;
  } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [highlightPath, setHighlightPath] = useState<string | null>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);

  const loadRoot = useCallback(() => {
    if (!scan) return;
    setRootLoading(true);
    invoke<FileEntryInfo[]>("list_file_entries", { scanId: scan.id, parentPath: null })
      .then((entries) => {
        setRootNodes(entries.map(toTreeNode));
        setChildrenCache(new Map());
      })
      .catch(console.error)
      .finally(() => setRootLoading(false));
  }, [scan?.id]);

  const loadChildren = useCallback(
    (parentPath: string) => {
      if (!scan) return;
      setLoadingPaths((prev) => new Set(prev).add(parentPath));
      invoke<FileEntryInfo[]>("list_file_entries", {
        scanId: scan.id,
        parentPath: parentPath || null,
      })
        .then((entries) => {
          const nodes = entries.map(toTreeNode);
          setChildrenCache((prev) => {
            const next = new Map(prev);
            next.set(parentPath, nodes);
            return next;
          });
        })
        .catch(console.error)
        .finally(() => {
          setLoadingPaths((prev) => {
            const next = new Set(prev);
            next.delete(parentPath);
            return next;
          });
        });
    },
    [scan?.id]
  );

  useEffect(() => {
    if (!scan) return;
    let cancelled = false;
    setSearch("");
    setSearchResults(null);
    setLatestStats(null);
    setHighlightPath(null);

    const reveal = (focusPath ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const parts = reveal.split("/").filter(Boolean);

    async function openToPath() {
      setRootLoading(true);
      try {
        const rootEntries = await invoke<FileEntryInfo[]>("list_file_entries", {
          scanId: scan!.id,
          parentPath: null,
        });
        if (cancelled) return;
        setRootNodes(rootEntries.map(toTreeNode));

        if (!reveal) {
          setChildrenCache(new Map());
          setExpanded(new Set([""]));
          return;
        }

        const ancestors = parts.slice(0, -1);
        const cache = new Map<string, TreeNode[]>();
        const open = new Set<string>([""]);
        for (let i = 0; i < ancestors.length; i++) {
          const parent = ancestors.slice(0, i + 1).join("/");
          open.add(parent);
          const entries = await invoke<FileEntryInfo[]>("list_file_entries", {
            scanId: scan!.id,
            parentPath: parent,
          });
          if (cancelled) return;
          cache.set(parent, entries.map(toTreeNode));
        }
        if (focusIsDirectory) {
          open.add(reveal);
          const entries = await invoke<FileEntryInfo[]>("list_file_entries", {
            scanId: scan!.id,
            parentPath: reveal,
          });
          if (cancelled) return;
          cache.set(reveal, entries.map(toTreeNode));
        }
        setChildrenCache(cache);
        setExpanded(open);
        setHighlightPath(reveal);
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setRootLoading(false);
      }
    }

    openToPath();
    return () => {
      cancelled = true;
    };
  }, [scan?.id, focusPath, focusIsDirectory]);

  useEffect(() => {
    if (!scan || !search.trim()) {
      setSearchResults(null);
      return;
    }
    const q = search.trim();
    setSearchLoading(true);
    invoke<FileEntryInfo[]>("search_file_entries", {
      scanId: scan.id,
      query: q,
      limit: 500,
    })
      .then(setSearchResults)
      .catch(console.error)
      .finally(() => setSearchLoading(false));
  }, [scan?.id, search]);

  function togglePath(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const expandedForSearch = useMemo(() => {
    if (!search.trim() || !searchResults?.length) return expanded;
    const next = new Set(expanded);
    for (const e of searchResults) {
      const pathNorm = e.path.replace(/\\/g, "/");
      const parts = pathNorm.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        next.add(parts.slice(0, i).join("/"));
      }
    }
    return next;
  }, [expanded, search, searchResults]);

  const displayTree = useMemo(() => {
    if (search.trim() && searchResults?.length) {
      return buildTreeFromEntries(searchResults, sortBy);
    }
    return sortTreeNodes(rootNodes, sortBy);
  }, [search, searchResults, rootNodes, sortBy]);

  const sortedChildrenCache = useMemo(() => {
    const next = new Map<string, TreeNode[]>();
    for (const [k, v] of childrenCache) {
      next.set(k, sortTreeNodes(v, sortBy));
    }
    return next;
  }, [childrenCache, sortBy]);

  const isLoading = rootLoading || (!!search.trim() && searchLoading);

  if (!scan) return null;

  const displayTitle = scan.label
    ? `${scan.label} (${scan.serial_number})`
    : scan.serial_number;
  const effectiveCompletedAt = latestStats?.scan_completed_at ?? scan.scan_completed_at;
  const effectiveFileCount = latestStats?.file_count ?? scan.file_count;
  const effectiveTotalSize = latestStats?.total_size_bytes ?? scan.total_size_bytes;
  const effectiveCatalogName = scan.catalog_name || "Vše";
  const createdYear =
    effectiveCompletedAt != null && Number.isFinite(effectiveCompletedAt)
      ? new Date(effectiveCompletedAt).getFullYear()
      : null;

  const isFavorite = scan.is_favorite === 1;

  async function handleToggleFavorite() {
    try {
      await invoke("toggle_favorite", { id: scan!.id });
      onFavoriteToggle?.(scan!);
    } catch (err) {
      console.error("Toggle favorite failed:", err);
    }
  }

  async function handleRefreshScan() {
    if (!scan || refreshingScan) return;
    try {
      setRefreshingScan(true);
      const selected = await open({
        directory: true,
        title: "Vyberte médium/složku pro aktualizaci skenu",
      });
      const sourcePath = Array.isArray(selected) ? selected[0] : selected;
      if (!sourcePath) return;
      const result = await invoke<RefreshScanResult>("refresh_media_scan", { id: scan.id, sourcePath });
      const completedAt = Date.now();
      setLatestStats({
        file_count: result.file_count,
        total_size_bytes: result.total_size_bytes,
        scan_completed_at: completedAt,
      });
      onScanUpdated?.(scan.id, {
        file_count: result.file_count,
        total_size_bytes: result.total_size_bytes,
        scan_completed_at: completedAt,
        drive_path: sourcePath,
      });
      loadRoot();
      setSuccessNotice({
        title: "Sken aktualizován",
        body: [
          "Sken byl úspěšně aktualizován.",
          "",
          `Číslo disku: ${result.serial_number}`,
          `Souborů: ${result.file_count.toLocaleString("cs-CZ")}`,
          `Velikost: ${formatSize(result.total_size_bytes)}`,
        ].join("\n"),
      });
    } catch (err) {
      await message(
        err instanceof Error ? err.message : "Aktualizace skenu selhala.",
        { title: "Media Catalog", kind: "error" }
      );
    } finally {
      setRefreshingScan(false);
    }
  }

  const sortLabels: Record<SortBy, string> = {
    name: "Název",
    date: "Datum vytvoření",
    type: "Typ souboru",
    size: "Velikost",
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-5 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-highlight text-highlight-foreground">
            <Disc size={20} weight="fill" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">{displayTitle}</h2>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={handleToggleFavorite}
            aria-label={isFavorite ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
          >
            <Star size={18} weight={isFavorite ? "fill" : "regular"} className={isFavorite ? "text-amber-500" : ""} />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" onClick={() => onEdit(scan)}>
            <PencilSimple size={18} />
            <span className="sr-only">Upravit</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={handleRefreshScan}
            disabled={refreshingScan}
          >
            <ArrowsClockwise size={18} className={refreshingScan ? "animate-spin" : ""} />
            <span className="sr-only">Aktualizovat sken</span>
          </Button>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" onClick={() => onDelete(scan)}>
            <Trash size={18} />
            <span className="sr-only">Odebrat</span>
          </Button>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" onClick={onClose}>
            <X size={20} />
            <span className="sr-only">Zavřít</span>
          </Button>
        </div>
      </div>

      <Separator />

      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* Metadata */}
        <div className="shrink-0 px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm min-w-0">
            <span className="text-muted-foreground text-xs uppercase tracking-wider shrink-0">Číslo disku</span>
            <span className="font-mono font-medium text-foreground shrink-0">{scan.serial_number}</span>
            <span className="text-border shrink-0">·</span>
            <span className="text-muted-foreground text-xs uppercase tracking-wider shrink-0">Rok vytvoření</span>
            <span className="font-medium text-foreground">
              {createdYear && Number.isFinite(createdYear) ? createdYear : "Neznámý"}
            </span>
            <span className="text-border shrink-0">·</span>
            <span className="text-muted-foreground text-xs uppercase tracking-wider shrink-0">Katalog</span>
            <span className="text-foreground/90 shrink-0">{effectiveCatalogName}</span>
            <span className="text-border shrink-0">·</span>
            <span className="text-muted-foreground text-xs uppercase tracking-wider shrink-0">Cesta</span>
            <span className="truncate text-foreground/90 min-w-0" title={scan.drive_path}>
              {scan.drive_path}
            </span>
            <span className="text-border shrink-0">·</span>
            <span className="text-foreground/90 shrink-0">
              {effectiveFileCount.toLocaleString()} souborů · {formatSize(effectiveTotalSize)}
            </span>
          </div>
        </div>

        <Separator />

        {/* Tree section */}
        <div className="flex-1 flex flex-col min-h-0 px-5 py-4">
          <div className="flex flex-col gap-4 min-h-0 h-full">
            <div className="flex items-center gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 px-3">
                    <CaretDown size={14} weight="bold" className="opacity-70" />
                    {sortLabels[sortBy]}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[180px]">
                  <DropdownMenuLabel>Řazení</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
                    <DropdownMenuRadioItem value="name">Název</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="date">Datum vytvoření</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="type">Typ souboru</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="size">Velikost</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="ml-auto w-full max-w-sm">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Hledat v tomto skenu..."
                  inputClassName="h-9 text-sm"
                  iconSize={16}
                />
              </div>
            </div>
            <div
              ref={treeScrollRef}
              className="flex-1 min-h-0 overflow-auto rounded-lg border border-border/60 bg-muted/10 p-3 [scrollbar-color:var(--sidebar-accent)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-sidebar-accent/70 hover:[&::-webkit-scrollbar-thumb]:bg-sidebar-accent"
            >
              {isLoading ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2 py-2">
                  <SpinnerGap size={16} className="animate-spin shrink-0" />
                  Načítání...
                </p>
              ) : displayTree.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  {search.trim()
                    ? "Žádné soubory ani složky neodpovídají hledání"
                    : "Žádné složky ani soubory"}
                </p>
              ) : (
                <VirtualizedFolderTree
                  nodes={displayTree}
                  expanded={expandedForSearch}
                  loadingPaths={loadingPaths}
                  onToggle={togglePath}
                  loadChildren={loadChildren}
                  childrenCache={sortedChildrenCache}
                  useNodeChildren={!!search.trim()}
                  parentRef={treeScrollRef}
                  highlightPath={search.trim() ? null : highlightPath}
                />
              )}
            </div>
          </div>
        </div>
      </div>
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
    </div>
  );
}
