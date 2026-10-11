"use client";

import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Disc, FolderOpen, SpinnerGap, CheckCircle, Warning, HardDrive, ArrowsClockwise } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface DriveInfo {
  letter: string;
  path: string;
}

interface ScanResult {
  id: string;
  serial_number: string;
  file_count: number;
  total_size_bytes: number;
}

type Catalog = { id: string; parent_id?: string | null; name: string };

export function ScannerPanel({
  onScanComplete,
}: {
  onScanComplete?: (scanId: string) => void;
}) {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [catalogId, setCatalogId] = useState<string>("root");
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [cdromDrives, setCdromDrives] = useState<DriveInfo[]>([]);
  const unlistenRef = useRef<(() => void) | null>(null);
  const serialInputRef = useRef<HTMLInputElement>(null);
  const catalogSelectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    loadDrives();
    loadCdromDrives();
    invoke<Catalog[]>("list_catalogs").then(setCatalogs).catch(console.error);
  }, []);

  useEffect(() => {
    let mounted = true;
    listen<{ files: number; done?: boolean }>("scan-progress", (ev) => {
      if (!mounted || ev.payload?.done) return;
      const files = ev.payload?.files;
      if (typeof files === "number") setScanProgress(files);
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });
    return () => {
      mounted = false;
      unlistenRef.current?.();
    };
  }, []);

  async function loadCdromDrives() {
    try {
      const result = await invoke<DriveInfo[]>("list_cdrom_drives");
      setCdromDrives(result);
    } catch (e) {
      console.error("Failed to load CD-ROM drives:", e);
    }
  }

  async function loadDrives() {
    try {
      const result = await invoke<DriveInfo[]>("list_drives");
      setDrives(result);
    } catch (e) {
      console.error("Failed to load drives:", e);
    } finally {
      setLoading(false);
    }
  }

  async function refreshDriveSources() {
    setLoading(true);
    await Promise.all([loadCdromDrives(), loadDrives()]);
  }

  async function openFolder() {
    try {
      const path = await open({
        directory: true,
        title: "Vyberte složku ke skenování",
      });
      if (path && typeof path === "string") {
        setSelectedPath(path);
      }
    } catch (e) {
      console.error("Failed to open folder dialog:", e);
    }
  }

  async function startScan() {
    const path = selectedPath;
    if (!path) return;
    const serialVal = (serialInputRef.current?.value ?? serialNumber).trim();
    const catalogVal = catalogSelectRef.current?.value ?? catalogId;
    const args = {
      path,
      label: label.trim() || undefined,
      catalogId: (catalogVal && catalogVal !== "") ? catalogVal : "root",
      serialNumber: serialVal || undefined,
    };
    setScanning(true);
    setScanProgress(0);
    setMessage(null);
    try {
      const result = await invoke<ScanResult>("scan_path", args);
      setMessage({
        type: "success",
        text: `Sken dokončen: ${result.serial_number} (${result.file_count.toLocaleString()} souborů)`,
      });
      onScanComplete?.(result.id);
    } catch (e) {
      setMessage({
        type: "error",
        text: String(e),
      });
    } finally {
      setScanning(false);
      setScanProgress(0);
    }
  }

  return (
    <Card className="overflow-hidden rounded-2xl border-0 shadow-[0_1px_2px_oklch(0_0_0/0.04),0_10px_28px_oklch(0_0_0/0.05)]">
      <CardHeader className="space-y-1.5 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-highlight text-highlight-foreground">
            <Disc size={18} weight="fill" />
          </div>
          <CardTitle className="text-xl tracking-tight">Nový sken</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-medium">Číslo disku (volitelně)</label>
          <Input
            ref={serialInputRef}
            placeholder="např. MC-00001"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            className="bg-background font-mono"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Popisek (volitelně)</label>
          <Input
            placeholder="např. Záloha práce 2024"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="bg-background"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Katalog</label>
          <select
            ref={catalogSelectRef}
            value={catalogId}
            onChange={(e) => setCatalogId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {catalogs.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-medium">Jednotka CD-ROM</label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={refreshDriveSources}
              disabled={loading || scanning}
            >
              <ArrowsClockwise size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {loading ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">
                <SpinnerGap size={18} className="animate-spin shrink-0" />
                Načítání...
              </div>
            ) : cdromDrives.length > 0 ? (
              cdromDrives.map((d) => (
                <Button
                  key={d.path}
                  variant={selectedPath === d.path ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setSelectedPath(d.path)}
                >
                  <Disc size={16} weight="fill" />
                  {d.letter}
                </Button>
              ))
            ) : (
              <p className="rounded-lg border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">
                Žádná jednotka CD-ROM nenalezena
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Ostatní zdroje</label>
          <div className="flex flex-wrap gap-2">
            {drives
              .filter((d) => !cdromDrives.some((cd) => cd.path === d.path))
              .map((d) => (
                <Button
                  key={d.path}
                  variant={selectedPath === d.path ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setSelectedPath(d.path)}
                >
                  <HardDrive size={14} weight="fill" />
                  {d.letter}
                </Button>
              ))}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={openFolder}>
              <FolderOpen size={16} />
              Vybrat složku...
            </Button>
          </div>
        </div>

        {selectedPath && (
          <p className="text-sm text-muted-foreground">
            Vybráno: <code className="bg-muted/80 px-2 py-0.5 rounded-md text-xs font-mono">{selectedPath}</code>
          </p>
        )}

        {scanning && scanProgress > 0 && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Zpracováno {scanProgress.toLocaleString()} souborů</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full animate-pulse rounded-full bg-highlight transition-[width] duration-500"
                style={{
                  width: `${Math.min(92, 15 + Math.log10(scanProgress + 1) * 25)}%`,
                }}
              />
            </div>
          </div>
        )}

        <Button
          onClick={startScan}
          disabled={!selectedPath || scanning}
          className="w-full font-medium"
        >
          {scanning ? (
            <>
              <SpinnerGap size={18} className="mr-2 animate-spin" />
              Skenuji...
            </>
          ) : (
            "Spustit skenování"
          )}
        </Button>

        {message && (
          <div
            className={`flex items-center gap-2.5 rounded-lg border p-3 text-sm ${
              message.type === "success"
                ? "border-green-200/60 bg-green-50 dark:bg-green-950/30 dark:border-green-800/30 text-green-800 dark:text-green-200"
                : "border-red-200/60 bg-red-50 dark:bg-red-950/30 dark:border-red-800/30 text-red-800 dark:text-red-200"
            }`}
          >
            {message.type === "success" ? (
              <CheckCircle size={20} weight="fill" />
            ) : (
              <Warning size={20} weight="fill" />
            )}
            <span>{message.text}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
