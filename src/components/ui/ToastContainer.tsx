import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { type ToastItem, useAppStore } from "@/store/appStore";
import { cn } from "@/lib/cn";

function ToastCard({ toast }: { toast: ToastItem }) {
  const dismissToast = useAppStore((s) => s.dismissToast);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => {
      dismissToast(toast.id);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [paused, toast.id, dismissToast]);

  const Icon =
    toast.variant === "success"
      ? CheckCircle2
      : toast.variant === "warn"
        ? AlertTriangle
        : toast.variant === "danger"
          ? AlertCircle
          : Info;

  const accentClass =
    toast.variant === "success"
      ? "text-accent"
      : toast.variant === "warn"
        ? "text-warn"
        : toast.variant === "danger"
          ? "text-danger"
          : "text-info";

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={cn(
        "animate-toast-enter pointer-events-auto flex w-80 items-start gap-2.5 rounded-[10px] border border-border-strong bg-surface px-3 py-2.5 shadow-lg",
      )}
    >
      <Icon
        className={cn("mt-0.5 h-4 w-4 shrink-0", accentClass)}
        strokeWidth={1.9}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-fg">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-[12px] text-fg-muted">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        aria-label="Tutup notifikasi"
        className="btn-press rounded-md p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-3 bottom-10 z-50 flex flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
