"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CaretDown,
  File,
  FilmStrip,
  Folder,
  Image as ImageIcon,
  MusicNotes,
  SpinnerGap,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { MediaScan } from "./CDListItem";

export interface CatalogFileHit {
  id: string;
  path: string;
  name: string;
  is_directory: number;
  size_bytes: number | null;
  modified_at: number | null;
  media_scan_id: string;
  serial_number: string;
  scan_label: string | null;
  drive_path: string;
  scan_completed_at: number | null;
  file_count: number;
  total_size_bytes: number;
  is_favorite: number;
  catalog_id: string | null;
  catalog_name: string | null;
}

type SearchPayload = {
  hits: CatalogFileHit[];
  truncated: boolean;
};

const IMAGE_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".svg", ".raw",
]);
const VIDEO_EXT = new Set([".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v", ".mpg", ".mpeg"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma"]);

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function scanTitle(hit: CatalogFileHit): string {
  const label = (hit.scan_label ?? "").trim();
  return label ? `${label} (${hit.serial_number})` : hit.serial_number;
}

export function hitToScan(hit: CatalogFileHit): MediaScan {
  return {
    id: hit.media_scan_id,
    serial_number: hit.serial_number,
    label: hit.scan_label,
    drive_path: hit.drive_path,
    scan_completed_at: hit.scan_completed_at ?? 0,
    file_count: hit.file_count,
    total_size_bytes: hit.total_size_bytes,
    is_favorite: hit.is_favorite,
    catalog_id: hit.catalog_id,
    catalog_name: hit.catalog_name,
  };
}

function ResultIcon({ hit }: { hit: CatalogFileHit }) {
  if (hit.is_directory) {
    return <Folder size={18} weight="fill" className="text-amber-500 shrink-0" />;
  }
  const ext = extensionOf(hit.name);
  if (IMAGE_EXT.has(ext)) {
    return <ImageIcon size={18} className="text-sky-400 shrink-0" />;
  }
  if (VIDEO_EXT.has(ext)) {
    return <FilmStrip size={18} className="text-violet-400 shrink-0" />;
  }
  if (AUDIO_EXT.has(ext)) {
    return <MusicNotes size={18} className="text-emerald-400 shrink-0" />;
  }
  return <File size={18} className="text-muted-foreground shrink-0" />;
}

function foldSearch(value: string): string {
  let out = "";
  for (const ch of value) {
    const folded = (
      {
        á: "a", Á: "a", č: "c", Č: "c", ď: "d", Ď: "d",
        é: "e", É: "e", ě: "e", Ě: "e", í: "i", Í: "i",
        ň: "n", Ň: "n", ó: "o", Ó: "o", ř: "r", Ř: "r",
        š: "s", Š: "s", ť: "t", Ť: "t", ú: "u", Ú: "u",
        ů: "u", Ů: "u", ý: "y", Ý: "y", ž: "z", Ž: "z",
      } as Record<string, string>
    )[ch];
    out += folded ?? ch.toLowerCase();
  }
  return out;
}

function highlightName(name: string, query: string) {
  const q = foldSearch(query.trim());
  if (!q) return name;
  const folded = foldSearch(name);
  const at = folded.indexOf(q);
  if (at < 0) return name;
  return (
    <>
      {name.slice(0, at)}
      <mark className="rounded-sm bg-highlight px-0.5 text-highlight-foreground">
        {name.slice(at, at + q.length)}
      </mark>
      {name.slice(at + q.length)}
    </>
  );
}

type ResultSort = "name" | "type";

const SORT_LABELS: Record<ResultSort, string> = {
  name: "Název",
  type: "Typ souboru",
};

function compareHits(a: CatalogFileHit, b: CatalogFileHit, sortBy: ResultSort): number {
  if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1;
  if (sortBy === "type") {
    const extCmp = extensionOf(a.name).localeCompare(extensionOf(b.name));
    if (extCmp !== 0) return extCmp;
  }
  const byName = a.name.localeCompare(b.name, "cs", { sensitivity: "base", numeric: true });
  if (byName !== 0) return byName;
  return scanTitle(a).localeCompare(scanTitle(b), "cs", { sensitivity: "base", numeric: true });
}

const ROW_HEIGHT = 58;

export function CatalogSearchResults({
  query,
  onOpen,
}: {
  query: string;
  onOpen: (hit: CatalogFileHit) => void;
}) {
  const [hits, setHits] = useState<CatalogFileHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<ResultSort>("name");
  const parentRef = useRef<HTMLDivElement>(null);
  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) {
      setHits([]);
      setTruncated(false);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      invoke<SearchPayload>("search_catalog_files", { query: trimmed, limit: 500 })
        .then((payload) => {
          if (cancelled) return;
          setHits(payload.hits);
          setTruncated(payload.truncated);
          setError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setHits([]);
          setTruncated(false);
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  const sortedHits = useMemo(
    () => [...hits].sort((a, b) => compareHits(a, b, sortBy)),
    [hits, sortBy]
  );

  const virtualizer = useVirtualizer({
    count: sortedHits.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const summary = useMemo(() => {
    const folders = hits.filter((h) => h.is_directory).length;
    const files = hits.length - folders;
    return { folders, files };
  }, [hits]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-muted-foreground">
          {loading
            ? "Hledám soubory a složky…"
            : error
              ? "Vyhledávání se nepodařilo."
              : hits.length === 0
                ? `Nic neodpovídá „${trimmed}“.`
                : `${summary.files.toLocaleString("cs-CZ")} souborů · ${summary.folders.toLocaleString("cs-CZ")} složek`}
          {truncated && !loading ? " · zobrazeno prvních 500, upřesněte hledání" : ""}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 px-3">
              <CaretDown size={14} weight="bold" className="opacity-70" />
              {SORT_LABELS[sortBy]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[180px]">
            <DropdownMenuLabel>Řazení</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as ResultSort)}>
              <DropdownMenuRadioItem value="name">Název</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="type">Typ souboru</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error && (
        <p className="mb-3 shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/80 bg-card [scrollbar-color:var(--sidebar-accent)_transparent] [scrollbar-width:thin]"
      >
        {loading && hits.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <SpinnerGap size={16} className="animate-spin shrink-0" />
            Načítání výsledků…
          </p>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((row) => {
              const hit = sortedHits[row.index];
              const path = hit.path.replace(/\\/g, "/");
              return (
                <button
                  key={`${hit.media_scan_id}:${hit.id}`}
                  type="button"
                  className={cn(
                    "absolute left-0 flex w-full items-center gap-3 px-4 text-left hover:bg-muted/50"
                  )}
                  style={{
                    height: `${row.size}px`,
                    transform: `translateY(${row.start}px)`,
                  }}
                  onClick={() => onOpen(hit)}
                >
                  <ResultIcon hit={hit} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {highlightName(hit.name, trimmed)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground" title={path}>
                      {path}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-right sm:block">
                    <span className="block max-w-56 truncate text-xs text-foreground/90">
                      {scanTitle(hit)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {hit.catalog_name || "Vše"}
                      {!hit.is_directory && hit.size_bytes != null
                        ? ` · ${formatSize(hit.size_bytes)}`
                        : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
