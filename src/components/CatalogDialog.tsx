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

export interface Catalog {
  id: string;
  parent_id: string | null;
  name: string;
}

export function CatalogCreateDialog({
  parentId,
  open,
  onOpenChange,
  onCreated,
}: {
  parentId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
    }
  }, [open]);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await invoke("create_catalog", {
        parent_id: parentId || "root",
        name: trimmed,
      });
      onCreated?.();
      onOpenChange(false);
    } catch (err) {
      const msg = String(err);
      const isTauriMissing = msg.includes("undefined") && msg.includes("invoke");
      setError(
        isTauriMissing
          ? "Prohlížeč nemá přístup k backendu. Spusťte desktop aplikaci: npx tauri dev (vyžaduje Rust: rustup.rs)"
          : msg
      );
      console.error("Create catalog failed:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nový katalog</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <label className="text-sm font-medium">Název</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="např. Software"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim() || saving}
          >
            {saving ? "Vytvářím..." : "Vytvořit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CatalogEditDialog({
  catalog,
  open,
  onOpenChange,
  onSaved,
}: {
  catalog: Catalog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (catalog) setName(catalog.name);
  }, [catalog, open]);

  async function handleSave() {
    if (!catalog) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await invoke("update_catalog", { id: catalog.id, name: trimmed });
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      console.error("Update catalog failed:", err);
    } finally {
      setSaving(false);
    }
  }

  if (!catalog) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upravit katalog</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">Název</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Název katalogu"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? "Ukládám..." : "Uložit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
