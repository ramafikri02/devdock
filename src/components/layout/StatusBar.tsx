import { Cpu, MemoryStick, TerminalSquare, Globe } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/cn";

export function StatusBar() {
  const logDrawerOpen = useAppStore((s) => s.logDrawerOpen);
  const toggleLogDrawer = useAppStore((s) => s.toggleLogDrawer);
  const processes = useAppStore((s) => s.processes);
  const portConflictCount = useAppStore((s) => s.portSnapshot?.conflictCount ?? 0);
  const metrics = useAppStore((s) => s.metrics);
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const setRoute = useAppStore((s) => s.setRoute);

  const procList = Object.values(processes);
  const runningCount = procList.filter(
    (p) =>
      p.status === "running" ||
      p.status === "starting" ||
      p.status === "restarting",
  ).length;
  const crashedCount = procList.filter((p) => p.status === "crashed").length;
  const totalCpu = metrics ? metrics.totalCpuPercent : 0;
  const totalRam = metrics ? metrics.totalMemoryBytes : 0;

  return (
    <footer className="flex h-[28px] shrink-0 items-center justify-between border-t border-border bg-bg-topbar px-3 text-[11.5px] text-fg-muted">
      {/* Left: Global process summary */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              runningCount > 0 ? "bg-accent" : "bg-fg-faint/60",
            )}
            aria-hidden="true"
          />
          <span className="font-mono tabular-nums">{runningCount} jalan</span>
        </span>
        {crashedCount > 0 ? (
          <span className="flex items-center gap-1.5 text-danger">
            <span className="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
            <span className="font-mono tabular-nums">{crashedCount} crash</span>
          </span>
        ) : null}
        {portConflictCount > 0 ? (
          <button
            type="button"
            onClick={() => setRoute({ kind: "ports" })}
            className="flex items-center gap-1.5 rounded px-1 text-warn hover:bg-warn-soft"
          >
            <span className="h-2 w-2 rounded-full bg-warn" aria-hidden="true" />
            <span className="font-mono tabular-nums">
              {portConflictCount} bentrok port
            </span>
          </button>
        ) : null}
      </div>

      {/* Right: Logs ⌘J toggle, CPU, RAM, Proxy */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleLogDrawer}
          className={cn(
            "btn-press flex h-5 items-center gap-1.5 rounded px-1.5 font-medium",
            logDrawerOpen
              ? "bg-info-soft text-info"
              : "text-fg-muted hover:bg-surface-hover hover:text-fg",
          )}
        >
          <TerminalSquare className="h-3 w-3" aria-hidden="true" />
          <span>Logs</span>
          <kbd className="font-mono text-[10.5px] opacity-80">⌘J</kbd>
        </button>

        <span className="flex items-center gap-1 font-mono tabular-nums">
          <Cpu className="h-3 w-3 text-fg-faint" aria-hidden="true" />
          <span>{totalCpu.toFixed(1)}%</span>
        </span>

        <span className="flex items-center gap-1 font-mono tabular-nums">
          <MemoryStick className="h-3 w-3 text-fg-faint" aria-hidden="true" />
          <span>{totalRam > 0 ? formatBytes(totalRam) : "0 MB"}</span>
        </span>

        <button
          type="button"
          onClick={() => setRoute({ kind: "settings" })}
          title={
            proxyStatus?.running
              ? `Reverse proxy *.localhost aktif di port ${proxyStatus.boundPort}`
              : "Buka pengaturan reverse proxy"
          }
          className={cn(
            "hidden items-center gap-1 rounded px-1 font-mono sm:flex",
            proxyStatus?.running
              ? "text-info hover:bg-info-soft"
              : "text-fg-faint hover:bg-surface-hover hover:text-fg",
          )}
        >
          <Globe className="h-3 w-3" aria-hidden="true" />
          <span>
            {proxyStatus?.running && proxyStatus.boundPort
              ? `proxy *.localhost :${proxyStatus.boundPort}`
              : "proxy off"}
          </span>
        </button>
      </div>
    </footer>
  );
}
