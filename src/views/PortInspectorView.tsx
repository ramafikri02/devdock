import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Network,
  RefreshCw,
  Search,
  Skull,
} from "lucide-react";
import { type ListeningPortEntry, killPortOwner } from "@/lib/tauri";
import { useAppStore } from "@/store/appStore";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";

type PortFilter = "all" | "conflicts" | "devdock" | "external";

export function PortInspectorView() {
  const portSnapshot = useAppStore((s) => s.portSnapshot);
  const portsLoading = useAppStore((s) => s.portsLoading);
  const refreshPorts = useAppStore((s) => s.refreshPorts);
  const pushToast = useAppStore((s) => s.pushToast);

  const [filter, setFilter] = useState<PortFilter>("all");
  const [search, setSearch] = useState("");
  const [killTarget, setKillTarget] = useState<ListeningPortEntry | null>(null);
  const [killingPid, setKillingPid] = useState<number | null>(null);

  useEffect(() => {
    void refreshPorts();
  }, [refreshPorts]);

  const entries = portSnapshot?.entries ?? [];
  const conflictCount = portSnapshot?.conflictCount ?? 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter === "conflicts" && !entry.isConflict) return false;
      if (filter === "devdock" && !entry.isDevdock) return false;
      if (filter === "external" && entry.isDevdock) return false;
      if (!q) return true;
      return (
        String(entry.port).includes(q) ||
        String(entry.pid).includes(q) ||
        entry.processName.toLowerCase().includes(q) ||
        (entry.devdockServiceName?.toLowerCase().includes(q) ?? false) ||
        (entry.conflictServiceName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [entries, filter, search]);

  const handleConfirmKill = async () => {
    if (!killTarget) return;
    const target = killTarget;
    setKillTarget(null);
    setKillingPid(target.pid);
    try {
      await killPortOwner(target.pid);
      pushToast({
        title: `Port ${target.port} berhasil dibebaskan (PID ${target.pid} dihentikan)`,
        variant: "success",
      });
      await refreshPorts();
    } catch (err) {
      pushToast({
        title: `Gagal menghentikan PID ${target.pid}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setKillingPid(null);
    }
  };

  return (
    <div className="animate-view-enter mx-auto max-w-6xl space-y-5 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-fg">
            Port Inspector
          </h1>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            <span className="font-mono tabular-nums">{entries.length}</span> port TCP lokal aktif
            {conflictCount > 0 ? (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 font-mono text-[11.5px] font-medium text-warn tabular-nums">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {conflictCount} bentrok
              </span>
            ) : (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                Tidak ada bentrok
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          disabled={portsLoading}
          onClick={() => void refreshPorts()}
          className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg disabled:opacity-50"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", portsLoading && "animate-spin")}
            aria-hidden="true"
          />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter & Search toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-[8px] border border-border bg-surface p-0.5 text-[12.5px]"
          role="tablist"
          aria-label="Filter port"
        >
          {(
            [
              ["all", `Semua (${entries.length})`],
              ["conflicts", `Bentrok (${conflictCount})`],
              ["devdock", "DevDock"],
              ["external", "Eksternal"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-[6px] px-2.5 py-1 font-medium transition-colors",
                filter === key
                  ? "bg-surface-hover text-fg"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative w-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint"
            aria-hidden="true"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari port, PID, proses…"
            aria-label="Cari port, PID, atau nama proses"
            className="h-8 w-full rounded-[7px] border border-border-strong bg-surface-2 pr-3 pl-8 text-[12.5px] text-fg placeholder:text-fg-faint"
          />
        </div>
      </div>

      {/* Ports table */}
      <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <Network
              className="mb-2 h-6 w-6 text-fg-faint"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <p className="text-[13px] font-medium text-fg">
              {portsLoading
                ? "Memindai port lokal…"
                : "Tidak ada port listening yang cocok dengan filter."}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-[11.5px] font-semibold tracking-wide text-fg-muted uppercase">
                <th className="px-4 py-2.5">Port</th>
                <th className="px-4 py-2.5">Proses</th>
                <th className="px-4 py-2.5">PID</th>
                <th className="px-4 py-2.5">Pemilik</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-[13px]">
              {filtered.map((entry) => (
                <tr
                  key={`${entry.port}-${entry.pid}`}
                  className={cn(
                    "transition-colors hover:bg-surface-hover/40",
                    entry.isConflict && "bg-warn-soft/35",
                  )}
                >
                  <td className="px-4 py-2.5 font-mono font-semibold text-fg tabular-nums">
                    <span>:{entry.port}</span>
                    <span className="ml-1.5 text-[11px] font-normal text-fg-faint">
                      {entry.address}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12.5px] text-fg-2">
                    {entry.processName}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-fg-muted tabular-nums">
                    {entry.pid}
                  </td>
                  <td className="px-4 py-2.5">
                    {entry.isDevdock ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-2 py-0.5 text-[11.5px] font-medium text-info">
                        DevDock · {entry.devdockServiceName ?? "service"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-fg-muted">
                        Eksternal
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {entry.isConflict ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11.5px] font-medium text-warn">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        Bentrok dengan {entry.conflictServiceName}
                      </span>
                    ) : (
                      <span className="text-[12px] text-fg-muted">Listening</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      disabled={killingPid === entry.pid}
                      onClick={() => setKillTarget(entry)}
                      className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-danger/45 bg-danger-soft px-2.5 text-[11.5px] font-medium text-danger hover:bg-danger-solid hover:text-white disabled:opacity-45"
                    >
                      <Skull className="h-3 w-3" aria-hidden="true" />
                      <span>{killingPid === entry.pid ? "Killing…" : "Kill"}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={killTarget !== null}
        title={
          killTarget
            ? `Hentikan proses ${killTarget.processName} (PID ${killTarget.pid})?`
            : ""
        }
        description={
          killTarget
            ? `Port :${killTarget.port} sedang dipakai oleh ${killTarget.processName} (PID ${killTarget.pid}). Proses akan menerima SIGTERM lalu SIGKILL jika tidak berhenti.`
            : ""
        }
        confirmLabel="Kill Proses"
        onCancel={() => setKillTarget(null)}
        onConfirm={() => void handleConfirmKill()}
      />
    </div>
  );
}
