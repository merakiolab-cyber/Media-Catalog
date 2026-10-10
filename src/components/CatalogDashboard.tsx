"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Database as DatabaseIcon,
  Disc,
  Folder,
  HardDrive,
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl bg-card shadow-sm"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-semibold tracking-tight text-foreground">Přehled katalogu</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {STAT_CARDS.map(({ key, label, icon: Icon, getValue }) => (
          <div
            key={key}
            className="rounded-2xl bg-card p-4 shadow-[0_1px_2px_oklch(0_0_0/0.04),0_10px_28px_oklch(0_0_0/0.05)]"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {label}
              </p>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-highlight text-highlight-foreground">
                <Icon size={16} weight="fill" />
              </div>
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
              {stats ? getValue(stats) : "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
