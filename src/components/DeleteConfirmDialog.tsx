"use client";

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import type { MediaScan } from "./CDListItem";

export function DeleteConfirmDialog({
  scan,
  open,
  onOpenChange,
  onConfirmDelete,
  onDeleteSuccess,
  onDeleteError,
}: {
  scan: MediaScan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDelete?: (scan: MediaScan) => void;
  onDeleteSuccess?: (scanId: string) => void;
  onDeleteError?: (scanId: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setDeleting(false);
  }, [open]);

  if (!scan) return null;

  const displayName = scan.label
    ? `${scan.label} (${scan.serial_number})`
    : scan.serial_number;

  async function handleDelete() {
    if (!scan) return;
    const scanId = scan.id;
    setDeleting(true);
    setError(null);
    onConfirmDelete?.(scan);
    try {
      await invoke("delete_media_scan", { id: scanId });
      onDeleteSuccess?.(scanId);
    } catch (err) {
      console.error("Delete failed:", err);
      onDeleteError?.(scanId);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { setError(null); onOpenChange(o); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Odebrat sken?</AlertDialogTitle>
          <AlertDialogDescription>
            Opravdu chcete odebrat „{displayName}“? Tato akce smaže celou strukturu
            souborů z katalogu.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="text-sm text-destructive mt-1">{error}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Zrušit</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Odebírání…" : "Odebrat"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
