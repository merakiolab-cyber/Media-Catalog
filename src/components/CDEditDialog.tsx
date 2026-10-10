"use client";

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MediaScan } from "./CDListItem";

type Catalog = { id: string; name: string };

export function CDEditDialog({
  scan,
  open,
  onOpenChange,
  onSaved,
}: {
  scan: MediaScan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [label, setLabel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [catalogId, setCatalogId] = useState<string>("root");
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      invoke<Catalog[]>("list_catalogs")
        .then(setCatalogs)
        .catch(console.error);
    }
  }, [open]);

  useEffect(() => {
    if (scan) {
      setLabel(scan.label || "");
      setSerialNumber(scan.serial_number || "");
      setCatalogId(scan.catalog_id ?? "root");
    }
  }, [scan, open]);

  async function handleSave() {
    if (!scan) return;
    const sn = serialNumber.trim();
    if (!sn) {
      alert("Číslo disku nemůže být prázdné");
      return;
    }
    setSaving(true);
    try {
      await invoke("update_media_scan", {
        id: scan.id,
        label: label,
        serialNumber: sn,
        catalogId: catalogId || "root",
      });
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      console.error("Update failed:", err);
      alert(typeof err === "string" ? err : "Chyba při ukládání");
    } finally {
      setSaving(false);
    }
  }

  if (!scan) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upravit sken</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Název / popisek</label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="např. Záloha práce 2024"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Číslo disku</label>
            <Input
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              placeholder="např. MC-00001"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Formát např. MC-00001, musí být jedinečné
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Katalog</label>
            <select
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Ukládám..." : "Uložit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
