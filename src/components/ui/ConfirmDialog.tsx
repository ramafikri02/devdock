import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[1px]"
      onClick={onCancel}
    >
      <div
        className="animate-modal-enter w-full max-w-md rounded-[12px] border border-border-strong bg-surface p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-danger-soft text-danger">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-[14.5px] font-semibold text-fg">{title}</h3>
              <p className="mt-1 text-[12.5px] text-fg-muted">{description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Tutup dialog"
            className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn-press h-8 rounded-[7px] bg-danger-solid px-3.5 text-[12.5px] font-semibold text-white hover:opacity-95"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
