import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Network,
  RefreshCw,
  Search,
  Skull,
  X,
} from "lucide-react";
import { type ListeningPortEntry, killPortOwner } from "@/lib/tauri";
import { useAppStore } from "@/store/appStore";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";

type PortFilter = "all" | "conflicts" | "devdock" | "external";

function getRowKey(entry: ListeningPortEntry): string {
  return `${entry.port}-${entry.pid}`;
}

export function PortInspectorView() {
  const portSnapshot = useAppStore((s) => s.portSnapshot);
  const portsLoading = useAppStore((s) => s.portsLoading);
  const refreshPorts = useAppStore((s) => s.refreshPorts);
  const pushToast = useAppStore((s) => s.pushToast);

  const [filter, setFilter] = useState<PortFilter>("all");
  const [search, setSearch] = useState("");
  const [killTarget, setKillTarget] = useState<ListeningPortEntry | null>(null);
  const [killingPid, setKillingPid] = useState<number | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);
  const [killingBulk, setKillingBulk] = useState(false);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

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

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedKeys.has(getRowKey(entry))),
    [entries, selectedKeys],
  );

  const uniqueSelectedPids = useMemo(() => {
    const seen = new Map<number, ListeningPortEntry>();
    for (const entry of selectedEntries) {
      if (!seen.has(entry.pid)) {
        seen.set(entry.pid, entry);
      }
    }
    return Array.from(seen.values());
  }, [selectedEntries]);

  const filteredSelectedCount = useMemo(
    () => filtered.filter((entry) => selectedKeys.has(getRowKey(entry))).length,
    [filtered, selectedKeys],
  );

  const allFilteredSelected =
    filtered.length > 0 && filteredSelectedCount === filtered.length;
  const someFilteredSelected =
    filteredSelectedCount > 0 && filteredSelectedCount < filtered.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someFilteredSelected;
    }
  }, [someFilteredSelected]);

  const toggleRowSelection = (entry: ListeningPortEntry) => {
    const key = getRowKey(entry);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const entry of filtered) {
          next.delete(getRowKey(entry));
        }
      } else {
        for (const entry of filtered) {
          next.add(getRowKey(entry));
        }
      }
      return next;
    });
  };

  const handleConfirmKill = async () => {
    if (!killTarget) return;
    const target = killTarget;
    setKillTarget(null);
    setKillingPid(target.pid);
    try {
      await killPortOwner(target.pid);
      pushToast({
        title: `Freed port ${target.port} (killed PID ${target.pid})`,
        variant: "success",
      });
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const entry of entries) {
          if (entry.pid === target.pid) {
            next.delete(getRowKey(entry));
          }
        }
        return next;
      });
      await refreshPorts();
    } catch (err) {
      pushToast({
        title: `Failed to kill PID ${target.pid}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setKillingPid(null);
    }
  };

  const handleConfirmBulkKill = async () => {
    if (uniqueSelectedPids.length === 0) return;
    const targets = uniqueSelectedPids;
    setConfirmBulkOpen(false);
    setKillingBulk(true);
    try {
      const results = await Promise.allSettled(
        targets.map((entry) => killPortOwner(entry.pid)),
      );
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - succeeded;

      if (failed === 0) {
        pushToast({
          title: `Killed ${succeeded} ${succeeded === 1 ? "process" : "processes"}`,
          variant: "success",
        });
      } else if (succeeded > 0) {
        pushToast({
          title: `Killed ${succeeded} ${succeeded === 1 ? "process" : "processes"}, ${failed} failed`,
          variant: "warn",
        });
      } else {
        pushToast({
          title: `Failed to kill ${failed} selected ${failed === 1 ? "process" : "processes"}`,
          variant: "danger",
        });
      }

      setSelectedKeys(new Set());
      await refreshPorts();
    } finally {
      setKillingBulk(false);
    }
  };

  return (
    <div className="animate-view-enter w-full space-y-5 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-fg">
            Port Inspector
          </h1>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            <span className="font-mono tabular-nums">{entries.length}</span> active local TCP {entries.length === 1 ? "port" : "ports"}
            {conflictCount > 0 ? (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 font-mono text-[11.5px] font-medium text-warn tabular-nums">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {conflictCount} {conflictCount === 1 ? "conflict" : "conflicts"}
              </span>
            ) : (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                No conflicts
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
          aria-label="Filter ports"
        >
          {(
            [
              ["all", `All (${entries.length})`],
              ["conflicts", `Conflicts (${conflictCount})`],
              ["devdock", "DevDock"],
              ["external", "External"],
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
            placeholder="Search port, PID, process…"
            aria-label="Search port, PID, or process name"
            className="h-8 w-full rounded-[7px] border border-border-strong bg-surface-2 pr-3 pl-8 text-[12.5px] text-fg placeholder:text-fg-faint"
          />
        </div>
      </div>

      {/* Bulk selection bar */}
      {selectedEntries.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-danger/35 bg-surface px-4 py-2.5">
          <div className="flex items-center gap-2 text-[12.5px] text-fg">
            <span className="font-mono font-semibold text-fg tabular-nums">
              {selectedEntries.length}
            </span>
            <span className="text-fg-muted">
              {selectedEntries.length === 1 ? "port" : "ports"} selected ({uniqueSelectedPids.length} unique {uniqueSelectedPids.length === 1 ? "process" : "processes"})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={killingBulk}
              onClick={() => setSelectedKeys(new Set())}
              className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-border-strong bg-surface-2 px-2.5 text-[11.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg disabled:opacity-45"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              <span>Cancel</span>
            </button>
            <button
              type="button"
              disabled={killingBulk}
              onClick={() => setConfirmBulkOpen(true)}
              className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] bg-danger-solid px-2.5 text-[11.5px] font-semibold text-white hover:opacity-95 disabled:opacity-45"
            >
              <Skull className="h-3 w-3" aria-hidden="true" />
              <span>
                {killingBulk
                  ? "Killing…"
                  : `Kill Selected (${uniqueSelectedPids.length})`}
              </span>
            </button>
          </div>
        </div>
      ) : null}

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
                ? "Scanning local ports…"
                : "No listening ports match the current filter."}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-[11.5px] font-semibold tracking-wide text-fg-muted uppercase">
                <th className="w-10 px-4 py-2.5">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allFilteredSelected}
                    disabled={killingBulk || filtered.length === 0}
                    onChange={toggleSelectAllFiltered}
                    aria-label="Select all displayed ports"
                    className="h-3.5 w-3.5 cursor-pointer rounded border-border-strong accent-accent align-middle"
                  />
                </th>
                <th className="px-4 py-2.5">Port</th>
                <th className="px-4 py-2.5">Process</th>
                <th className="px-4 py-2.5">PID</th>
                <th className="px-4 py-2.5">Owner</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-[13px]">
              {filtered.map((entry) => {
                const rowKey = getRowKey(entry);
                const isSelected = selectedKeys.has(rowKey);
                return (
                <tr
                  key={rowKey}
                  className={cn(
                    "transition-colors hover:bg-surface-hover/40",
                    isSelected && "bg-surface-hover/60",
                    entry.isConflict && !isSelected && "bg-warn-soft/35",
                  )}
                >
                  <td className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={killingBulk}
                      onChange={() => toggleRowSelection(entry)}
                      aria-label={`Select port :${entry.port} PID ${entry.pid}`}
                      className="h-3.5 w-3.5 cursor-pointer rounded border-border-strong accent-accent align-middle"
                    />
                  </td>
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
                        External
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {entry.isConflict ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11.5px] font-medium text-warn">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        Conflicts with {entry.conflictServiceName}
                      </span>
                    ) : (
                      <span className="text-[12px] text-fg-muted">Listening</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      disabled={killingPid === entry.pid || killingBulk}
                      onClick={() => setKillTarget(entry)}
                      className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-danger/45 bg-danger-soft px-2.5 text-[11.5px] font-medium text-danger hover:bg-danger-solid hover:text-white disabled:opacity-45"
                    >
                      <Skull className="h-3 w-3" aria-hidden="true" />
                      <span>{killingPid === entry.pid ? "Killing…" : "Kill"}</span>
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={killTarget !== null}
        title={
          killTarget
            ? `Kill process ${killTarget.processName} (PID ${killTarget.pid})?`
            : ""
        }
        description={
          killTarget
            ? `Port :${killTarget.port} is currently in use by ${killTarget.processName} (PID ${killTarget.pid}). The process will receive SIGTERM followed by SIGKILL if it does not exit.`
            : ""
        }
        confirmLabel="Kill Process"
        onCancel={() => setKillTarget(null)}
        onConfirm={() => void handleConfirmKill()}
      />

      <ConfirmDialog
        open={confirmBulkOpen}
        title={`Kill ${uniqueSelectedPids.length} selected ${uniqueSelectedPids.length === 1 ? "process" : "processes"}?`}
        description={`This will terminate ${uniqueSelectedPids.length} unique ${uniqueSelectedPids.length === 1 ? "process" : "processes"} covering ${selectedEntries.length} selected ${selectedEntries.length === 1 ? "port" : "ports"} (${uniqueSelectedPids
          .slice(0, 5)
          .map((e) => `${e.processName} :${e.port}`)
          .join(", ")}${uniqueSelectedPids.length > 5 ? ", …" : ""}). Each process will receive SIGTERM followed by SIGKILL if it does not exit.`}
        confirmLabel={`Kill ${uniqueSelectedPids.length} ${uniqueSelectedPids.length === 1 ? "Process" : "Processes"}`}
        onCancel={() => setConfirmBulkOpen(false)}
        onConfirm={() => void handleConfirmBulkKill()}
      />
    </div>
  );
}
