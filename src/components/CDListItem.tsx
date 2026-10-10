"use client";

import { Disc, DotsThree, Star, Folder, HardDrive } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const DRAG_TYPE_SCAN = "application/x-media-catalog-scan";

export interface MediaScan {
  id: string;
  serial_number: string;
  label: string | null;
  drive_path: string;
  scan_completed_at: number | null;
  file_count: number;
  total_size_bytes: number;
  is_favorite?: number;
  catalog_id?: string | null;
  catalog_name?: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function CDListItem({
  scan,
  onRefresh,
  onDetail,
  onEdit,
  onDelete,
}: {
  scan: MediaScan;
  onRefresh: () => void;
  onDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const displayTitle = scan.label
    ? `${scan.label} (${scan.serial_number})`
    : scan.serial_number;
  const isFavorite = scan.is_favorite === 1;

  const CATEGORY_STYLES: Record<string, string> = {
    Zálohy: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    Fotky: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    Práce: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    Vše: "bg-muted text-muted-foreground border-border/60",
  };
  const tagStyle = (scan.catalog_name && CATEGORY_STYLES[scan.catalog_name]) ?? "bg-primary/10 text-primary border-primary/20";

  async function handleToggleFavorite(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await invoke("toggle_favorite", { id: scan.id });
      onRefresh();
    } catch (err) {
      console.error("Toggle favorite failed:", err);
    }
  }

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          DRAG_TYPE_SCAN,
          JSON.stringify({ scanId: scan.id, catalogId: scan.catalog_id ?? "root" })
        );
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "group flex items-center gap-4 rounded-xl border border-border/70 bg-card p-4 transition-all duration-200",
        "hover:border-border hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20",
        "cursor-grab active:cursor-grabbing"
      )}
      onClick={onDetail}
    >
      {/* Ikona CD média */}
      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 ring-1 ring-primary/5">
        <Disc size={24} weight="fill" className="text-primary" />
      </div>

      {/* Hlavní obsah */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-base font-semibold text-foreground">{displayTitle}</span>
          {scan.catalog_name && (
            <span
              className={cn(
                "shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium",
                tagStyle
              )}
            >
              {scan.catalog_name}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{scan.serial_number}</span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1 truncate max-w-[180px]">
            <Folder size={12} weight="regular" className="shrink-0 opacity-60" />
            {scan.drive_path}
          </span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1 shrink-0">
            <HardDrive size={12} weight="regular" className="shrink-0 opacity-60" />
            {scan.file_count.toLocaleString()} souborů · {formatSize(scan.total_size_bytes)}
          </span>
        </div>
      </div>

      {/* Akce */}
      <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-lg hover:bg-amber-500/10"
          onClick={handleToggleFavorite}
          aria-label={isFavorite ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
        >
          {isFavorite ? (
            <Star size={20} weight="fill" className="text-amber-500" />
          ) : (
            <Star size={20} weight="regular" className="text-muted-foreground hover:text-amber-500" />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9 rounded-lg">
              <DotsThree size={18} weight="bold" className="text-muted-foreground" />
              <span className="sr-only">Menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDetail}>Zobrazit detail</DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>Upravit</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              Odebrat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
