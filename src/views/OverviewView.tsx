import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ChevronRight,
  FolderPlus,
  GitBranch,
  HardDrive,
  LayoutGrid,
  List,
  Network,
  Package,
  Play,
  PlayCircle,
  RefreshCw,
  RotateCw,
  Search,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  FRAMEWORK_LABELS,
  type MetricPoint,
  type ProcessInfo,
  type Project,
  type Service,
} from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { useAppStore } from "@/store/appStore";
import {
  Sparkline,
  TelemetryAreaChart,
  type TelemetryPoint,
} from "@/components/ui/MetricChart";
import { cn } from "@/lib/cn";

interface OverviewViewProps {
  projectCount?: number;
  serviceCount?: number;
  onAddProject?: () => void;
}

type OverviewFilter = "all" | "running" | "issues";
type OverviewLayoutMode = "grouped" | "cards";

interface ServiceEntry {
  project: Project;
  service: Service;
  activeProcesses: ProcessInfo[];
  latestCrashed: ProcessInfo | null;
  hasPortConflict: boolean;
  conflictPid: number | null;
  conflictProcessName: string | null;
  status: "running" | "restarting" | "crashed" | "conflict" | "missing" | "stopped";
  isRunnableServer: boolean;
}

const RUNNABLE_SCRIPT_NAMES = new Set([
  "dev",
  "start",
  "start:dev",
  "serve",
  "preview",
  "watch",
  "develop",
]);

function isServiceRunnableServer(service: Service): boolean {
  if (service.defaultScript && service.scripts[service.defaultScript]) {
    return true;
  }
  const scriptNames = Object.keys(service.scripts);
  return scriptNames.some((name) => {
    const lower = name.toLowerCase();
    return (
      RUNNABLE_SCRIPT_NAMES.has(lower) ||
      lower.startsWith("dev:") ||
      lower.startsWith("start:")
    );
  });
}

function StatusPill({ status }: { status: ServiceEntry["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
        Running
      </span>
    );
  }
  if (status === "restarting") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
        <span
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn"
          aria-hidden="true"
        />
        Restarting
      </span>
    );
  }
  if (status === "crashed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        Crashed
      </span>
    );
  }
  if (status === "conflict") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
        <Network className="h-3 w-3" aria-hidden="true" />
        Bentrok Port
      </span>
    );
  }
  if (status === "missing") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
        Missing
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-muted">
      Stopped
    </span>
  );
}

export function OverviewView({
  projectCount = 0,
  serviceCount = 0,
  onAddProject,
}: OverviewViewProps) {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const projects = useAppStore((s) => s.projects);
  const globalStorage = useAppStore((s) => s.globalStorage);
  const storageLoading = useAppStore((s) => s.storageLoading);
  const refreshGlobalStorage = useAppStore((s) => s.refreshGlobalStorage);
  const refreshPorts = useAppStore((s) => s.refreshPorts);
  const processes = useAppStore((s) => s.processes);
  const portSnapshot = useAppStore((s) => s.portSnapshot);
  const metrics = useAppStore((s) => s.metrics);
  const gitInfoByService = useAppStore((s) => s.gitInfoByService);
  const setRoute = useAppStore((s) => s.setRoute);
  const runScript = useAppStore((s) => s.runScript);
  const stopProcess = useAppStore((s) => s.stopProcess);
  const startProjectAll = useAppStore((s) => s.startProjectAll);
  const stopProjectAll = useAppStore((s) => s.stopProjectAll);
  const restartProjectAll = useAppStore((s) => s.restartProjectAll);
  const orchestratingProjectIds = useAppStore((s) => s.orchestratingProjectIds);
  const assignNextFreePort = useAppStore((s) => s.assignNextFreePort);
  const openLogsForProcess = useAppStore((s) => s.openLogsForProcess);
  const pushToast = useAppStore((s) => s.pushToast);

  const [filter, setFilter] = useState<OverviewFilter>("all");
  const [layoutMode, setLayoutMode] = useState<OverviewLayoutMode>("grouped");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Record<string, boolean>>({});
  const [showUtilityByProject, setShowUtilityByProject] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // Pause snapshots for live telemetry charts
  const [cpuPaused, setCpuPaused] = useState(false);
  const [ramPaused, setRamPaused] = useState(false);
  const [frozenCpuHistory, setFrozenCpuHistory] = useState<MetricPoint[] | null>(null);
  const [frozenRamHistory, setFrozenRamHistory] = useState<MetricPoint[] | null>(null);

  // Lightweight periodic port conflict refresh (10s) while Overview is visible
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshPorts();
      }
    }, 10_000);
    return () => window.clearInterval(id);
  }, [refreshPorts]);

  const procList = useMemo(() => Object.values(processes), [processes]);
  const runningCount = procList.filter(
    (p) =>
      p.status === "running" ||
      p.status === "starting" ||
      p.status === "restarting",
  ).length;
  const crashedCount = procList.filter((p) => p.status === "crashed").length;
  const conflictCount = portSnapshot?.conflictCount ?? 0;
  const totalCpu = metrics?.totalCpuPercent ?? 0;
  const totalRam = metrics?.totalMemoryBytes ?? 0;

  const liveHistory = useMemo(
    () => metrics?.globalHistory ?? [],
    [metrics?.globalHistory],
  );

  const cpuSeries: TelemetryPoint[] = useMemo(() => {
    const src = cpuPaused && frozenCpuHistory ? frozenCpuHistory : liveHistory;
    return src.slice(-90).map((p) => ({
      timestampMs: p.timestampMs,
      value: p.cpuPercent,
    }));
  }, [cpuPaused, frozenCpuHistory, liveHistory]);

  const ramSeries: TelemetryPoint[] = useMemo(() => {
    const src = ramPaused && frozenRamHistory ? frozenRamHistory : liveHistory;
    return src.slice(-90).map((p) => ({
      timestampMs: p.timestampMs,
      value: p.memoryBytes,
    }));
  }, [ramPaused, frozenRamHistory, liveHistory]);

  const cpuStats = useMemo(() => {
    if (cpuSeries.length === 0) return { peak: 0, avg: 0 };
    let peak = 0;
    let sum = 0;
    for (const p of cpuSeries) {
      if (p.value > peak) peak = p.value;
      sum += p.value;
    }
    return { peak, avg: sum / cpuSeries.length };
  }, [cpuSeries]);

  const ramStats = useMemo(() => {
    if (ramSeries.length === 0) return { peak: 0, avg: 0 };
    let peak = 0;
    let sum = 0;
    for (const p of ramSeries) {
      if (p.value > peak) peak = p.value;
      sum += p.value;
    }
    return { peak, avg: sum / ramSeries.length };
  }, [ramSeries]);

  const toggleCpuPause = () => {
    if (!cpuPaused) {
      setFrozenCpuHistory(liveHistory);
      setCpuPaused(true);
    } else {
      setCpuPaused(false);
      setFrozenCpuHistory(null);
    }
  };

  const toggleRamPause = () => {
    if (!ramPaused) {
      setFrozenRamHistory(liveHistory);
      setRamPaused(true);
    } else {
      setRamPaused(false);
      setFrozenRamHistory(null);
    }
  };

  const conflictByServiceId = useMemo(() => {
    const map = new Map<string, { pid: number; processName: string }>();
    for (const entry of portSnapshot?.entries ?? []) {
      if (entry.isConflict && entry.conflictServiceId) {
        map.set(entry.conflictServiceId, {
          pid: entry.pid,
          processName: entry.processName,
        });
      }
    }
    return map;
  }, [portSnapshot]);

  const serviceEntries: ServiceEntry[] = useMemo(() => {
    const list: ServiceEntry[] = [];
    for (const project of projects) {
      for (const service of project.services) {
        const svcProcs = procList
          .filter((p) => p.serviceId === service.id)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        const activeProcesses = svcProcs.filter(
          (p) =>
            p.status === "running" ||
            p.status === "starting" ||
            p.status === "restarting" ||
            p.status === "stopping",
        );
        const latestCrashed =
          activeProcesses.length === 0
            ? (svcProcs.find((p) => p.status === "crashed") ?? null)
            : null;
        const conflict = conflictByServiceId.get(service.id);
        const hasPortConflict = Boolean(conflict);

        const status: ServiceEntry["status"] = service.isMissing
          ? "missing"
          : activeProcesses.some((p) => p.status === "restarting")
            ? "restarting"
            : activeProcesses.length > 0
              ? "running"
              : latestCrashed
                ? "crashed"
                : hasPortConflict
                  ? "conflict"
                  : "stopped";

        list.push({
          project,
          service,
          activeProcesses,
          latestCrashed,
          hasPortConflict,
          conflictPid: conflict?.pid ?? null,
          conflictProcessName: conflict?.processName ?? null,
          status,
          isRunnableServer: isServiceRunnableServer(service),
        });
      }
    }

    const priority: Record<ServiceEntry["status"], number> = {
      crashed: 0,
      conflict: 1,
      restarting: 2,
      running: 3,
      missing: 4,
      stopped: 5,
    };
    list.sort((a, b) => priority[a.status] - priority[b.status]);
    return list;
  }, [projects, procList, conflictByServiceId]);

  const entryByServiceId = useMemo(() => {
    const map = new Map<string, ServiceEntry>();
    for (const entry of serviceEntries) {
      map.set(entry.service.id, entry);
    }
    return map;
  }, [serviceEntries]);

  const attentionEntries = useMemo(
    () =>
      serviceEntries.filter(
        (e) =>
          e.status === "crashed" ||
          e.status === "conflict" ||
          e.status === "restarting" ||
          e.status === "running" ||
          e.status === "missing",
      ),
    [serviceEntries],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const matchesFilters = (entry: ServiceEntry): boolean => {
    if (selectedProjectId !== "all" && entry.project.id !== selectedProjectId) {
      return false;
    }
    if (filter === "running") {
      if (entry.status !== "running" && entry.status !== "restarting") return false;
    } else if (filter === "issues") {
      if (
        entry.status !== "crashed" &&
        entry.status !== "conflict" &&
        entry.status !== "missing"
      ) {
        return false;
      }
    }
    if (!normalizedQuery) return true;
    const fw = FRAMEWORK_LABELS[entry.service.detectedFramework].toLowerCase();
    const portStr = entry.service.port !== null ? String(entry.service.port) : "";
    return (
      entry.service.name.toLowerCase().includes(normalizedQuery) ||
      entry.project.name.toLowerCase().includes(normalizedQuery) ||
      fw.includes(normalizedQuery) ||
      portStr.includes(normalizedQuery)
    );
  };

  const filteredEntries = useMemo(
    () => serviceEntries.filter(matchesFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serviceEntries, selectedProjectId, filter, normalizedQuery],
  );

  const groupedProjects = useMemo(() => {
    return projects
      .filter((p) => selectedProjectId === "all" || p.id === selectedProjectId)
      .map((project) => {
        const allItems = project.services
          .map((svc) => entryByServiceId.get(svc.id))
          .filter((item): item is ServiceEntry => Boolean(item));
        const matchedItems = allItems.filter(matchesFilters);
        return { project, allItems, matchedItems };
      })
      .filter((g) => g.matchedItems.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, selectedProjectId, entryByServiceId, filter, normalizedQuery]);

  // Top active consumers for the 3rd analytics card when processes are running
  const topConsumers = useMemo(() => {
    const active = serviceEntries
      .filter((e) => e.status === "running" || e.status === "restarting")
      .map((e) => {
        const m = metrics?.byService[e.service.id];
        return {
          entry: e,
          cpu: m?.currentCpuPercent ?? 0,
          ram: m?.currentMemoryBytes ?? 0,
        };
      })
      .sort((a, b) => b.ram - a.ram || b.cpu - a.cpu);
    return active.slice(0, 4);
  }, [serviceEntries, metrics]);

  // Storage breakdown for idle state in the 3rd analytics card
  const storageBreakdown = useMemo(() => {
    if (!globalStorage || globalStorage.cachedServiceCount === 0) return null;
    const total = Math.max(globalStorage.totalBytes, 1);
    const nm = globalStorage.nodeModulesBytes;
    const cache = globalStorage.buildCacheBytes;
    const other = Math.max(0, globalStorage.totalBytes - nm - cache);
    return {
      totalBytes: globalStorage.totalBytes,
      reclaimableBytes: globalStorage.reclaimableBytes,
      segments: [
        {
          label: "node_modules",
          bytes: nm,
          pct: (nm / total) * 100,
          barClass: "bg-warn",
          dotClass: "bg-warn",
        },
        {
          label: "Build cache",
          bytes: cache,
          pct: (cache / total) * 100,
          barClass: "bg-info",
          dotClass: "bg-info",
        },
        {
          label: "Source & lain",
          bytes: other,
          pct: (other / total) * 100,
          barClass: "bg-border-strong",
          dotClass: "bg-border-strong",
        },
      ],
    };
  }, [globalStorage]);

  const allCollapsed =
    groupedProjects.length > 0 &&
    groupedProjects.every((g) => Boolean(collapsedProjectIds[g.project.id]));

  const toggleAllProjectsCollapse = () => {
    const next: Record<string, boolean> = {};
    const collapse = !allCollapsed;
    for (const g of groupedProjects) {
      next[g.project.id] = collapse;
    }
    setCollapsedProjectIds(next);
  };

  const handleQuickRun = async (service: Service, scriptName?: string) => {
    const script =
      scriptName ??
      (service.defaultScript && service.scripts[service.defaultScript]
        ? service.defaultScript
        : Object.keys(service.scripts)[0]);
    if (!script) return;
    setBusyId(service.id);
    try {
      await runScript(service.id, script);
    } catch (err) {
      pushToast({
        title: `Gagal menjalankan ${service.name}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleQuickStop = async (serviceId: string, active: ProcessInfo[]) => {
    setBusyId(serviceId);
    try {
      for (const p of active) {
        await stopProcess(p.id);
      }
    } catch (err) {
      pushToast({
        title: "Gagal menghentikan proses",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusyId(null);
    }
  };

  const renderServiceActionButtons = (item: ServiceEntry, compact = false) => {
    const hasScripts = Object.keys(item.service.scripts).length > 0;
    return (
      <div className="flex items-center gap-1.5">
        {item.activeProcesses.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => openLogsForProcess(item.activeProcesses[0].id)}
              aria-label={`Lihat log ${item.service.name}`}
              title="Lihat log"
              className="btn-press inline-flex h-7 items-center rounded-[6px] border border-border-strong bg-surface-2 px-2 text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              <TerminalSquare className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={busyId === item.service.id}
              onClick={() => void handleQuickStop(item.service.id, item.activeProcesses)}
              className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-danger/45 bg-danger-soft px-2.5 text-[11.5px] font-medium text-danger hover:bg-danger-solid hover:text-white disabled:opacity-45"
            >
              <Square className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
              <span>Stop</span>
            </button>
          </>
        ) : item.status === "conflict" ? (
          <button
            type="button"
            onClick={() => void assignNextFreePort(item.service.id)}
            className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-warn/50 bg-warn-soft px-2.5 text-[11.5px] font-medium text-warn hover:opacity-90"
          >
            <Network className="h-3 w-3" aria-hidden="true" />
            <span>Pakai port lain</span>
          </button>
        ) : !item.service.isMissing && hasScripts ? (
          <button
            type="button"
            disabled={busyId === item.service.id}
            onClick={() =>
              void handleQuickRun(item.service, item.latestCrashed?.script)
            }
            className={cn(
              "btn-press inline-flex h-7 items-center gap-1 rounded-[6px] px-2.5 text-[11.5px] font-semibold disabled:opacity-45",
              item.isRunnableServer || item.status === "crashed"
                ? "bg-accent text-accent-fg hover:opacity-95"
                : "border border-border-strong bg-surface-2 text-fg-2 hover:bg-surface-hover hover:text-fg",
            )}
          >
            <Play className="h-3 w-3 fill-current" aria-hidden="true" />
            <span>{item.status === "crashed" ? "Jalankan lagi" : "Start"}</span>
          </button>
        ) : null}

        {compact ? (
          <button
            type="button"
            onClick={() =>
              setRoute({
                kind: "service",
                projectId: item.project.id,
                serviceId: item.service.id,
              })
            }
            aria-label={`Buka Workbench ${item.service.name}`}
            title="Buka Workbench"
            className="btn-press inline-flex h-7 w-7 items-center justify-center rounded-[6px] border border-border bg-surface-2 text-fg-muted hover:border-border-strong hover:bg-surface-hover hover:text-fg"
          >
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  };

  const renderServiceRow = (item: ServiceEntry) => {
    const svcMetrics = metrics?.byService[item.service.id];
    const cpuValues = svcMetrics?.history.slice(-24).map((p) => p.cpuPercent) ?? [];
    const currentCpu = svcMetrics?.currentCpuPercent ?? 0;
    const currentRam = svcMetrics?.currentMemoryBytes ?? 0;
    const isActive = item.status === "running" || item.status === "restarting";

    return (
      <div
        key={item.service.id}
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 transition-colors hover:bg-surface-hover/35",
          item.status === "crashed" && "bg-danger-soft/20",
          item.status === "conflict" && "bg-warn-soft/20",
        )}
      >
        {/* Left: Name, framework, status & issue snippet */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <StatusPill status={item.status} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setRoute({
                    kind: "service",
                    projectId: item.project.id,
                    serviceId: item.service.id,
                  })
                }
                className="truncate text-left text-[13.5px] font-semibold text-fg hover:text-info"
              >
                {item.service.name}
              </button>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-fg-muted">
                {FRAMEWORK_LABELS[item.service.detectedFramework]}
              </span>
              {item.service.port !== null ? (
                <span className="font-mono text-[11.5px] text-info tabular-nums">
                  :{item.service.port}
                </span>
              ) : null}
            </div>
            {item.status === "crashed" && item.latestCrashed ? (
              <p className="mt-0.5 truncate font-mono text-[11px] text-danger">
                exit {item.latestCrashed.exitCode ?? "—"}
                {item.latestCrashed.lastErrorSnippet
                  ? ` · ${item.latestCrashed.lastErrorSnippet}`
                  : ""}
              </p>
            ) : item.status === "conflict" ? (
              <p className="mt-0.5 truncate text-[11px] text-warn">
                Port :{item.service.port} dipakai {item.conflictProcessName} (PID{" "}
                {item.conflictPid})
              </p>
            ) : null}
          </div>
        </div>

        {/* Middle: Compact live metrics + sparkline */}
        <div className="flex items-center gap-3">
          {isActive ? (
            <div className="flex items-center gap-2.5 rounded-[7px] border border-border bg-surface-2 px-2.5 py-1">
              <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
                <span className="text-fg-2">
                  <span className="text-fg-faint">CPU</span>{" "}
                  <span className="font-semibold text-fg">{currentCpu.toFixed(1)}%</span>
                </span>
                <span className="text-fg-faint">·</span>
                <span className="text-fg-2">
                  <span className="text-fg-faint">RAM</span>{" "}
                  <span className="text-fg">
                    {currentRam > 0 ? formatBytes(currentRam) : "0 MB"}
                  </span>
                </span>
              </div>
              <Sparkline
                values={cpuValues}
                label={`Sparkline CPU ${item.service.name}: ${currentCpu.toFixed(1)}%`}
                strokeClass="stroke-accent"
                fillClass="fill-accent/15"
                className="h-5 w-14 shrink-0"
              />
            </div>
          ) : (
            <span className="hidden font-mono text-[11px] text-fg-faint tabular-nums sm:inline">
              {item.service.defaultScript
                ? item.service.defaultScript
                : Object.keys(item.service.scripts)[0] ?? "tanpa script"}
            </span>
          )}

          {/* Right: Quick actions */}
          {renderServiceActionButtons(item, true)}
        </div>
      </div>
    );
  };

  return (
    <div className="animate-view-enter w-full space-y-5 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-fg">Overview</h1>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            <span className="font-mono tabular-nums">{projectCount}</span> project ·{" "}
            <span className="font-mono tabular-nums">{serviceCount}</span> service terdaftar
            {bootstrap ? <> · Core v{bootstrap.version}</> : null}
          </p>
        </div>
      </div>

      {/* Layer 1: Compact Health & Operational Status Strip */}
      <div className="grid grid-cols-2 divide-y divide-border overflow-hidden rounded-[10px] border border-border bg-surface sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        {/* Jalan */}
        <button
          type="button"
          onClick={() => setFilter((f) => (f === "running" ? "all" : "running"))}
          className={cn(
            "flex items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-hover/40",
            filter === "running" && "bg-accent-soft/40",
          )}
        >
          <div className="min-w-0">
            <div className="text-[11.5px] font-medium text-fg-muted">Jalan</div>
            <div className="mt-0.5 flex items-baseline gap-1 font-mono tabular-nums">
              <span
                className={cn(
                  "text-[18px] font-semibold",
                  runningCount > 0 ? "text-accent" : "text-fg",
                )}
              >
                {runningCount}
              </span>
              <span className="text-[12px] text-fg-faint">/ {serviceCount}</span>
            </div>
          </div>
          <PlayCircle
            className={cn(
              "h-4 w-4 shrink-0",
              runningCount > 0 ? "text-accent" : "text-fg-faint",
            )}
            strokeWidth={1.85}
            aria-hidden="true"
          />
        </button>

        {/* Crash */}
        <button
          type="button"
          onClick={() => setFilter((f) => (f === "issues" ? "all" : "issues"))}
          className={cn(
            "flex items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-hover/40",
            filter === "issues" && "bg-danger-soft/40",
          )}
        >
          <div className="min-w-0">
            <div className="text-[11.5px] font-medium text-fg-muted">Crash</div>
            <div
              className={cn(
                "mt-0.5 font-mono text-[18px] font-semibold tabular-nums",
                crashedCount > 0 ? "text-danger" : "text-fg",
              )}
            >
              {crashedCount}
            </div>
          </div>
          <AlertTriangle
            className={cn(
              "h-4 w-4 shrink-0",
              crashedCount > 0 ? "text-danger" : "text-fg-faint",
            )}
            strokeWidth={1.85}
            aria-hidden="true"
          />
        </button>

        {/* Bentrok Port */}
        <button
          type="button"
          onClick={() => setRoute({ kind: "ports" })}
          className="flex items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-hover/40"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg-muted">
              <span>Bentrok Port</span>
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5 font-mono tabular-nums">
              <span
                className={cn(
                  "text-[18px] font-semibold",
                  conflictCount > 0 ? "text-warn" : "text-fg",
                )}
              >
                {conflictCount}
              </span>
              <span className="truncate font-sans text-[11px] text-fg-faint">
                {conflictCount > 0 ? "Buka Inspector" : "Aman"}
              </span>
            </div>
          </div>
          <Network
            className={cn(
              "h-4 w-4 shrink-0",
              conflictCount > 0 ? "text-warn" : "text-fg-faint",
            )}
            strokeWidth={1.85}
            aria-hidden="true"
          />
        </button>

        {/* Storage Reclaimable */}
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg-muted">
              <span>Storage</span>
              {serviceCount > 0 ? (
                <button
                  type="button"
                  onClick={() => void refreshGlobalStorage(true)}
                  aria-label="Hitung ulang storage global"
                  title="Hitung ulang storage"
                  className="rounded p-0.5 text-fg-faint hover:bg-surface-hover hover:text-fg"
                >
                  <RefreshCw
                    className={cn("h-3 w-3", storageLoading && "animate-spin")}
                    aria-hidden="true"
                  />
                </button>
              ) : null}
            </div>
            {storageLoading && !storageBreakdown ? (
              <div className="skeleton-shimmer mt-1 h-5 w-20 rounded-[5px]" />
            ) : (
              <div className="mt-0.5 flex items-baseline gap-1.5 font-mono tabular-nums">
                <span className="text-[18px] font-semibold text-fg">
                  {storageBreakdown ? formatBytes(storageBreakdown.totalBytes) : "—"}
                </span>
                {storageBreakdown && storageBreakdown.reclaimableBytes > 0 ? (
                  <span className="truncate font-sans text-[11px] text-warn">
                    {formatBytes(storageBreakdown.reclaimableBytes)} reclaimable
                  </span>
                ) : null}
              </div>
            )}
          </div>
          <HardDrive
            className="h-4 w-4 shrink-0 text-warn"
            strokeWidth={1.85}
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Layer 2: Live Telemetry & Analytics Row */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <TelemetryAreaChart
          title="CPU Total"
          currentText={`${totalCpu.toFixed(1)}%`}
          peakText={`${cpuStats.peak.toFixed(1)}%`}
          avgText={`${cpuStats.avg.toFixed(1)}%`}
          subtitle={runningCount > 0 ? `${runningCount} proses aktif` : "Tidak ada proses aktif"}
          points={cpuSeries}
          formatValue={(v) => `${v.toFixed(1)}%`}
          strokeColorVar="var(--info)"
          paused={cpuPaused}
          isLive={runningCount > 0}
          onTogglePause={toggleCpuPause}
        />

        <TelemetryAreaChart
          title="RAM Total"
          currentText={totalRam > 0 ? formatBytes(totalRam) : "0 MB"}
          peakText={ramStats.peak > 0 ? formatBytes(ramStats.peak) : "0 MB"}
          avgText={ramStats.avg > 0 ? formatBytes(ramStats.avg) : "0 MB"}
          subtitle="Pohon proses DevDock"
          points={ramSeries}
          formatValue={(v) => (v > 0 ? formatBytes(v) : "0 MB")}
          strokeColorVar="var(--accent)"
          paused={ramPaused}
          isLive={runningCount > 0}
          onTogglePause={toggleRamPause}
        />

        {/* Adaptive 3rd Analytics Card: Top Active Consumers OR Storage Distribution */}
        <div className="flex flex-col justify-between rounded-[10px] border border-border bg-surface p-4 lg:col-span-2 xl:col-span-1">
          {topConsumers.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[12px] font-medium text-fg-muted">
                    Top Konsumsi Aktif
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-fg-faint">
                    Urutan pemakaian RAM terbesar
                  </div>
                </div>
                <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10.5px] font-medium text-accent tabular-nums">
                  {runningCount} aktif
                </span>
              </div>

              <div className="mt-3 space-y-2.5">
                {topConsumers.map(({ entry, cpu, ram }) => {
                  const maxRam = Math.max(topConsumers[0].ram, 1);
                  const pct = Math.max(6, Math.round((ram / maxRam) * 100));
                  return (
                    <button
                      key={entry.service.id}
                      type="button"
                      onClick={() =>
                        setRoute({
                          kind: "service",
                          projectId: entry.project.id,
                          serviceId: entry.service.id,
                        })
                      }
                      className="group block w-full text-left"
                    >
                      <div className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="truncate font-medium text-fg group-hover:text-info">
                          {entry.service.name}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-fg-muted tabular-nums">
                          {cpu.toFixed(1)}% · {ram > 0 ? formatBytes(ram) : "0 MB"}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-accent transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 border-t border-border pt-2 text-[11px] text-fg-faint">
                Klik service untuk membuka grafik lengkap di Workbench
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[12px] font-medium text-fg-muted">
                    Distribusi Storage
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-fg-faint">
                    {storageBreakdown
                      ? `Total ${formatBytes(storageBreakdown.totalBytes)} lintas ${projectCount} project`
                      : "Belum ada data storage"}
                  </div>
                </div>
                {serviceCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => void refreshGlobalStorage(true)}
                    aria-label="Hitung ulang distribusi storage"
                    className="btn-press inline-flex h-6 items-center gap-1 rounded-[6px] border border-border-strong bg-surface-2 px-2 text-[10.5px] font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    <RefreshCw
                      className={cn("h-2.5 w-2.5", storageLoading && "animate-spin")}
                      aria-hidden="true"
                    />
                    <span>Scan</span>
                  </button>
                ) : null}
              </div>

              {storageLoading && !storageBreakdown ? (
                <div className="mt-4 space-y-2.5">
                  <div className="skeleton-shimmer h-2.5 w-full rounded-full" />
                  <div className="skeleton-shimmer h-4 w-3/4 rounded" />
                  <div className="skeleton-shimmer h-4 w-2/3 rounded" />
                </div>
              ) : storageBreakdown ? (
                <div className="mt-3 space-y-3">
                  {/* Stacked horizontal bar */}
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                    {storageBreakdown.segments.map((seg) =>
                      seg.bytes > 0 ? (
                        <div
                          key={seg.label}
                          className={cn("h-full", seg.barClass)}
                          style={{ width: `${Math.max(seg.pct, 2)}%` }}
                          title={`${seg.label}: ${formatBytes(seg.bytes)}`}
                        />
                      ) : null,
                    )}
                  </div>

                  {/* Breakdown legend */}
                  <div className="space-y-1.5">
                    {storageBreakdown.segments.map((seg) => (
                      <div
                        key={seg.label}
                        className="flex items-center justify-between text-[12px]"
                      >
                        <div className="flex items-center gap-2 text-fg-muted">
                          <span
                            className={cn("h-2 w-2 rounded-full", seg.dotClass)}
                            aria-hidden="true"
                          />
                          <span>{seg.label}</span>
                        </div>
                        <span className="font-mono text-[11.5px] text-fg tabular-nums">
                          {formatBytes(seg.bytes)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="my-auto py-4 text-center text-[12px] text-fg-faint">
                  Tambahkan project untuk melihat distribusi storage.
                </div>
              )}

              <div className="mt-3 flex items-center justify-between border-t border-border pt-2 font-mono text-[11px] text-fg-faint tabular-nums">
                <span>Bisa dibersihkan</span>
                <span className="text-warn">
                  {storageBreakdown
                    ? formatBytes(storageBreakdown.reclaimableBytes)
                    : "—"}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Layer 3: Active & Attention Section (only shown when something is running or has an issue) */}
      {attentionEntries.length > 0 && filter === "all" && !normalizedQuery ? (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-semibold tracking-wider text-fg-faint uppercase">
              Aktif & Perlu Perhatian ({attentionEntries.length})
            </h2>
          </div>
          <div className="divide-y divide-border overflow-hidden rounded-[10px] border border-border bg-surface">
            {attentionEntries.map((item) => renderServiceRow(item))}
          </div>
        </section>
      ) : null}

      {/* Layer 4: Projects & Services Explorer OR Empty State */}
      {serviceCount === 0 ? (
        <div className="rounded-[12px] border border-border bg-surface p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-info-soft text-info">
              <Activity className="h-4.5 w-4.5" strokeWidth={1.85} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[14.5px] font-semibold text-fg">
                DevDock siap digunakan
              </h2>
              <p className="mt-1 text-[13px] text-fg-muted">
                Tambahkan folder project Node.js untuk mendeteksi package manager,
                framework, dan daftar script secara otomatis.
              </p>
              {onAddProject ? (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={onAddProject}
                    className="btn-press inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[13px] font-semibold text-accent-fg hover:opacity-95"
                  >
                    <FolderPlus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    <span>Tambah Project</span>
                  </button>
                </div>
              ) : null}
              {bootstrap ? (
                <div className="mt-4 grid gap-2 rounded-[8px] border border-border bg-surface-2 p-3 font-mono text-[11.5px] text-fg-muted">
                  <div className="truncate">
                    <span className="text-fg-faint">DB:</span> {bootstrap.dbPath}
                  </div>
                  <div className="truncate">
                    <span className="text-fg-faint">Adapters:</span>{" "}
                    {bootstrap.adapters.join(", ")}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <section className="space-y-3">
          {/* Explorer Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <h2 className="text-[12px] font-semibold tracking-wider text-fg-faint uppercase">
                Projects & Services
              </h2>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-muted tabular-nums">
                {filteredEntries.length}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Inline Search */}
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter service, port…"
                  aria-label="Filter project atau service"
                  className="h-8 w-44 rounded-[7px] border border-border bg-surface pr-7 pl-8 text-[12.5px] text-fg placeholder:text-fg-faint focus:border-info focus:outline-none sm:w-52"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Hapus pencarian"
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-fg-faint hover:text-fg"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              {/* Project Dropdown when multiple projects exist */}
              {projects.length > 1 ? (
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  aria-label="Filter berdasarkan project"
                  className="h-8 rounded-[7px] border border-border bg-surface px-2.5 text-[12.5px] text-fg focus:border-info focus:outline-none"
                >
                  <option value="all">Semua Project ({projects.length})</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.services.length})
                    </option>
                  ))}
                </select>
              ) : null}

              {/* Status Segmented Filter */}
              <div
                className="inline-flex h-8 items-center rounded-[7px] border border-border bg-surface p-0.5 text-[12px]"
                role="tablist"
                aria-label="Filter status service"
              >
                {(
                  [
                    ["all", "Semua"],
                    ["running", "Jalan"],
                    ["issues", "Bermasalah"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={filter === key}
                    onClick={() => setFilter(key)}
                    className={cn(
                      "rounded-[5px] px-2.5 py-1 font-medium transition-colors",
                      filter === key
                        ? "bg-surface-hover text-fg"
                        : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Expand/Collapse All (Grouped mode with > 1 project) */}
              {layoutMode === "grouped" && groupedProjects.length > 1 ? (
                <button
                  type="button"
                  onClick={toggleAllProjectsCollapse}
                  className="btn-press h-8 rounded-[7px] border border-border bg-surface px-2.5 text-[12px] font-medium text-fg-muted hover:border-border-strong hover:text-fg"
                >
                  {allCollapsed ? "Expand semua" : "Lipat semua"}
                </button>
              ) : null}

              {/* Layout View Toggle */}
              <div
                className="inline-flex h-8 items-center rounded-[7px] border border-border bg-surface p-0.5"
                role="group"
                aria-label="Mode tampilan daftar service"
              >
                <button
                  type="button"
                  onClick={() => setLayoutMode("grouped")}
                  aria-pressed={layoutMode === "grouped"}
                  aria-label="Tampilan daftar per project"
                  title="Grouped List"
                  className={cn(
                    "inline-flex h-6.5 w-7 items-center justify-center rounded-[5px] transition-colors",
                    layoutMode === "grouped"
                      ? "bg-surface-hover text-fg"
                      : "text-fg-muted hover:text-fg",
                  )}
                >
                  <List className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode("cards")}
                  aria-pressed={layoutMode === "cards"}
                  aria-label="Tampilan kartu grid"
                  title="Cards Grid"
                  className={cn(
                    "inline-flex h-6.5 w-7 items-center justify-center rounded-[5px] transition-colors",
                    layoutMode === "cards"
                      ? "bg-surface-hover text-fg"
                      : "text-fg-muted hover:text-fg",
                  )}
                >
                  <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {/* Content: Empty Filter State / Grouped List / Cards Grid */}
          {filteredEntries.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-border bg-surface p-8 text-center text-[13px] text-fg-muted">
              Tidak ada service yang cocok dengan filter saat ini.
            </div>
          ) : layoutMode === "grouped" ? (
            <div className="space-y-3">
              {groupedProjects.map(({ project, allItems, matchedItems }) => {
                const isCollapsed = Boolean(collapsedProjectIds[project.id]);
                const projMetrics = metrics?.byProject[project.id];
                const runningInProj = allItems.filter(
                  (i) => i.status === "running" || i.status === "restarting",
                ).length;
                const isOrch = Boolean(orchestratingProjectIds[project.id]);
                const isMulti = project.services.length > 1;

                // Deduplicate shared git branch at project header level
                const firstGit = project.services
                  .map((s) => gitInfoByService[s.id])
                  .find((g) => g?.isGitRepo && g.branch);

                // Separate runnable services from utility/config packages (monorepo clarity)
                const primaryItems = matchedItems.filter(
                  (i) =>
                    i.isRunnableServer ||
                    i.status !== "stopped" ||
                    Boolean(normalizedQuery),
                );
                const utilityItems = matchedItems.filter(
                  (i) => !primaryItems.includes(i),
                );
                const effectivePrimary =
                  primaryItems.length > 0 ? primaryItems : matchedItems;
                const effectiveUtility =
                  primaryItems.length > 0 ? utilityItems : [];
                const showUtilities = Boolean(showUtilityByProject[project.id]);

                return (
                  <div
                    key={project.id}
                    className="overflow-hidden rounded-[10px] border border-border bg-surface"
                  >
                    {/* Project Group Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-2/50 px-4 py-2.5">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedProjectIds((prev) => ({
                              ...prev,
                              [project.id]: !prev[project.id],
                            }))
                          }
                          aria-expanded={!isCollapsed}
                          aria-label={
                            isCollapsed
                              ? `Tampilkan service di ${project.name}`
                              : `Lipat service di ${project.name}`
                          }
                          className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-fg-muted hover:bg-surface-hover hover:text-fg"
                        >
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 transition-transform",
                              !isCollapsed && "rotate-90",
                            )}
                            aria-hidden="true"
                          />
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            isMulti
                              ? setRoute({ kind: "project", projectId: project.id })
                              : setRoute({
                                  kind: "service",
                                  projectId: project.id,
                                  serviceId: project.services[0].id,
                                })
                          }
                          className="text-[14px] font-semibold text-fg hover:text-info"
                        >
                          {project.name}
                        </button>

                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 font-mono text-[11px] tabular-nums",
                            runningInProj === project.services.length && runningInProj > 0
                              ? "bg-accent-soft text-accent"
                              : runningInProj > 0
                                ? "bg-warn-soft text-warn"
                                : "bg-surface-2 text-fg-muted",
                          )}
                        >
                          {runningInProj}/{project.services.length} jalan
                        </span>

                        {firstGit?.branch ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]",
                              firstGit.isDirty ? "text-warn" : "text-fg-muted",
                            )}
                          >
                            <GitBranch className="h-2.5 w-2.5" aria-hidden="true" />
                            <span>
                              {firstGit.branch}
                              {firstGit.isDirty ? "*" : ""}
                            </span>
                          </span>
                        ) : null}

                        {projMetrics && projMetrics.currentMemoryBytes > 0 ? (
                          <span className="font-mono text-[11px] text-fg-faint tabular-nums">
                            {projMetrics.currentCpuPercent.toFixed(1)}% ·{" "}
                            {formatBytes(projMetrics.currentMemoryBytes)}
                          </span>
                        ) : null}
                      </div>

                      {/* Project-level orchestration actions */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isMulti ? (
                          runningInProj > 0 ? (
                            <>
                              <button
                                type="button"
                                disabled={isOrch}
                                onClick={() => void restartProjectAll(project.id)}
                                className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-border-strong bg-surface px-2.5 text-[11.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg disabled:opacity-45"
                              >
                                <RotateCw className="h-3 w-3" aria-hidden="true" />
                                <span>Restart All</span>
                              </button>
                              <button
                                type="button"
                                disabled={isOrch}
                                onClick={() => void stopProjectAll(project.id)}
                                className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-danger/45 bg-danger-soft px-2.5 text-[11.5px] font-medium text-danger hover:bg-danger-solid hover:text-white disabled:opacity-45"
                              >
                                <Square
                                  className="h-2.5 w-2.5 fill-current"
                                  aria-hidden="true"
                                />
                                <span>Stop All</span>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={isOrch}
                              onClick={() => void startProjectAll(project.id)}
                              className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] bg-accent px-2.5 text-[11.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-45"
                            >
                              <Play className="h-3 w-3 fill-current" aria-hidden="true" />
                              <span>Start All</span>
                            </button>
                          )
                        ) : null}

                        {isMulti ? (
                          <button
                            type="button"
                            onClick={() =>
                              setRoute({ kind: "project", projectId: project.id })
                            }
                            className="btn-press h-7 rounded-[6px] border border-border-strong bg-surface px-2.5 text-[11.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                          >
                            Buka Project
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {/* Expanded Service Rows */}
                    {!isCollapsed ? (
                      <div className="divide-y divide-border">
                        {effectivePrimary.map((item) => renderServiceRow(item))}

                        {/* Collapsible non-server utility packages */}
                        {effectiveUtility.length > 0 ? (
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                setShowUtilityByProject((prev) => ({
                                  ...prev,
                                  [project.id]: !prev[project.id],
                                }))
                              }
                              className="flex w-full items-center gap-2 bg-surface-2/30 px-4 py-2 text-left text-[11.5px] font-medium text-fg-muted hover:bg-surface-hover/40 hover:text-fg"
                            >
                              <Package className="h-3.5 w-3.5 text-fg-faint" aria-hidden="true" />
                              <span>
                                {showUtilities
                                  ? `Sembunyikan ${effectiveUtility.length} package lainnya`
                                  : `+ ${effectiveUtility.length} package lainnya (tanpa script dev/start)`}
                              </span>
                            </button>
                            {showUtilities ? (
                              <div className="divide-y divide-border border-t border-border bg-surface-2/15">
                                {effectiveUtility.map((item) => renderServiceRow(item))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Alternative Cards Grid View */
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredEntries.map((item) => {
                const svcMetrics = metrics?.byService[item.service.id];
                const cpuValues =
                  svcMetrics?.history.slice(-30).map((p) => p.cpuPercent) ?? [];
                const currentCpu = svcMetrics?.currentCpuPercent ?? 0;
                const currentRam = svcMetrics?.currentMemoryBytes ?? 0;

                return (
                  <div
                    key={item.service.id}
                    className={cn(
                      "flex flex-col justify-between rounded-[10px] border bg-surface p-4 transition-colors",
                      item.status === "crashed"
                        ? "border-danger/45"
                        : item.status === "conflict"
                          ? "border-warn/45"
                          : "border-border hover:border-border-strong",
                    )}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setRoute({
                              kind: "service",
                              projectId: item.project.id,
                              serviceId: item.service.id,
                            })
                          }
                          className="min-w-0 text-left"
                        >
                          <div className="truncate text-[14px] font-semibold text-fg hover:text-info">
                            {item.service.name}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-muted">
                            <span>{FRAMEWORK_LABELS[item.service.detectedFramework]}</span>
                            {item.project.services.length > 1 ? (
                              <>
                                <span>·</span>
                                <span>{item.project.name}</span>
                              </>
                            ) : null}
                            {item.service.port !== null ? (
                              <>
                                <span>·</span>
                                <span className="font-mono text-info tabular-nums">
                                  :{item.service.port}
                                </span>
                              </>
                            ) : null}
                          </div>
                        </button>

                        <StatusPill status={item.status} />
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3 rounded-[8px] border border-border bg-surface-2 px-3 py-2">
                        <div className="space-y-0.5 font-mono text-[11.5px] tabular-nums">
                          <div className="text-fg-2">
                            CPU{" "}
                            <span className="font-semibold text-fg">
                              {currentCpu.toFixed(1)}%
                            </span>
                          </div>
                          <div className="text-fg-muted">
                            RAM{" "}
                            <span className="text-fg">
                              {currentRam > 0 ? formatBytes(currentRam) : "0 MB"}
                            </span>
                          </div>
                        </div>
                        <Sparkline
                          values={cpuValues}
                          label={`Sparkline CPU ${item.service.name}: ${currentCpu.toFixed(1)}%`}
                          strokeClass={
                            item.status === "crashed"
                              ? "stroke-danger"
                              : item.status === "running"
                                ? "stroke-accent"
                                : "stroke-info"
                          }
                          fillClass={
                            item.status === "crashed"
                              ? "fill-danger/15"
                              : item.status === "running"
                                ? "fill-accent/15"
                                : "fill-info/15"
                          }
                          className="h-7 w-24 shrink-0"
                        />
                      </div>

                      {item.status === "crashed" && item.latestCrashed ? (
                        <p className="mt-2 truncate font-mono text-[11px] text-danger">
                          exit {item.latestCrashed.exitCode ?? "—"}
                          {item.latestCrashed.lastErrorSnippet
                            ? ` · ${item.latestCrashed.lastErrorSnippet}`
                            : ""}
                        </p>
                      ) : item.status === "conflict" ? (
                        <p className="mt-2 truncate text-[11.5px] text-warn">
                          Port :{item.service.port} dipakai {item.conflictProcessName} (PID{" "}
                          {item.conflictPid})
                        </p>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          setRoute({
                            kind: "service",
                            projectId: item.project.id,
                            serviceId: item.service.id,
                          })
                        }
                        className="text-[12px] font-medium text-fg-muted hover:text-fg"
                      >
                        Buka Workbench
                      </button>
                      {renderServiceActionButtons(item, false)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
