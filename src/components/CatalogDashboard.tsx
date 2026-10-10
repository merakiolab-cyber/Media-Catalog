"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Database as DatabaseIcon,
  Disc,
  Folder,
  HardDrive,
  ChartBar,
} from "@phosphor-icons/react";

type CatalogStats = {
  catalogs_count: number;
  scans_count: number;
  total_files: number;
  total_bytes: number;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const STAT_CARDS = [
  {
    key: "catalogs" as const,
    label: "Katalogy",
    icon: DatabaseIcon,
    getValue: (s: CatalogStats) => s.catalogs_count.toLocaleString(),
  },
  {
    key: "scans" as const,
    label: "Skeny",
    icon: Disc,
    getValue: (s: CatalogStats) => s.scans_count.toLocaleString(),
  },
  {
    key: "files" as const,
    label: "Soubory",
    icon: Folder,
    getValue: (s: CatalogStats) => s.total_files.toLocaleString(),
  },
  {
    key: "size" as const,
    label: "Celková velikost",
    icon: HardDrive,
    getValue: (s: CatalogStats) => formatSize(s.total_bytes),
  },
];

export function CatalogDashboard({ refreshTrigger }: { refreshTrigger?: number }) {
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const hasTauri =
      typeof window !== "undefined" &&
      !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    if (!hasTauri) {
      setStats(null);
      setLoading(false);
      return;
    }
    invoke<CatalogStats>("get_catalog_stats")
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refreshTrigger]);

  if (loading) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Přehled katalogu</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-border/60 bg-card p-4 h-24 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ChartBar size={18} weight="duotone" className="text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Přehled katalogu</h3>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map(({ key, label, icon: Icon, getValue }) => (
          <div
            key={key}
            className="rounded-xl border border-border/70 bg-card p-4 shadow-sm transition-colors hover:border-border/80"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Icon size={20} weight="duotone" className="text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{label}</p>
                <p className="text-lg font-semibold tabular-nums text-foreground truncate">
                  {stats ? getValue(stats) : "—"}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
