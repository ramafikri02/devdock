import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Cpu,
  FolderPlus,
  HardDrive,
  MemoryStick,
  Network,
  Play,
  PlayCircle,
  RefreshCw,
  Square,
  TerminalSquare,
} from "lucide-react";
import { FRAMEWORK_LABELS, type ProcessInfo, type Project, type Service } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { useAppStore } from "@/store/appStore";
import { Sparkline } from "@/components/ui/MetricChart";
import { cn } from "@/lib/cn";

interface OverviewViewProps {
  projectCount?: number;
  serviceCount?: number;
  onAddProject?: () => void;
}

type OverviewFilter = "all" | "running" | "issues";

interface ServiceCardEntry {
  project: Project;
  service: Service;
  activeProcesses: ProcessInfo[];
  latestCrashed: ProcessInfo | null;
  hasPortConflict: boolean;
  conflictPid: number | null;
  conflictProcessName: string | null;
  status: "running" | "restarting" | "crashed" | "conflict" | "missing" | "stopped";
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
  const processes = useAppStore((s) => s.processes);
  const portSnapshot = useAppStore((s) => s.portSnapshot);
  const metrics = useAppStore((s) => s.metrics);
  const setRoute = useAppStore((s) => s.setRoute);
  const runScript = useAppStore((s) => s.runScript);
  const stopProcess = useAppStore((s) => s.stopProcess);
  const assignNextFreePort = useAppStore((s) => s.assignNextFreePort);
  const openLogsForProcess = useAppStore((s) => s.openLogsForProcess);
  const pushToast = useAppStore((s) => s.pushToast);

  const [filter, setFilter] = useState<OverviewFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const serviceCards: ServiceCardEntry[] = useMemo(() => {
    const list: ServiceCardEntry[] = [];
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

        const status: ServiceCardEntry["status"] = service.isMissing
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
        });
      }
    }

    // Sort active & issue services first
    const priority: Record<ServiceCardEntry["status"], number> = {
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

  const filteredCards = useMemo(() => {
    if (filter === "running") {
      return serviceCards.filter(
        (c) => c.status === "running" || c.status === "restarting",
      );
    }
    if (filter === "issues") {
      return serviceCards.filter(
        (c) =>
          c.status === "crashed" ||
          c.status === "conflict" ||
          c.status === "missing",
      );
    }
    return serviceCards;
  }, [serviceCards, filter]);

  const multiServiceProjects = useMemo(
    () => projects.filter((p) => p.services.length > 1),
    [projects],
  );

  const nmDisplay =
    globalStorage && globalStorage.cachedServiceCount > 0
      ? formatBytes(globalStorage.nodeModulesBytes)
      : "—";
  const reclaimableSubtitle =
    globalStorage && globalStorage.reclaimableBytes > 0
      ? `${formatBytes(globalStorage.reclaimableBytes)} bisa dibersihkan`
      : null;

  const kpis = [
    {
      label: "Jalan",
      value: String(runningCount),
      icon: PlayCircle,
      tone: "text-accent",
      sub: null,
      onClick: () => setFilter("running"),
    },
    {
      label: "Crash",
      value: String(crashedCount),
      icon: AlertTriangle,
      tone: "text-danger",
      sub: null,
      onClick: () => setFilter("issues"),
    },
    {
      label: "Bentrok Port",
      value: String(conflictCount),
      icon: Network,
      tone: "text-warn",
      sub: conflictCount > 0 ? "Klik untuk Port Inspector" : null,
      onClick: () => setRoute({ kind: "ports" }),
    },
    {
      label: "CPU Total",
      value: `${totalCpu.toFixed(1)}%`,
      icon: Cpu,
      tone: "text-info",
      sub: runningCount > 0 ? "Sampling tiap 2d" : null,
      onClick: undefined,
    },
    {
      label: "RAM Total",
      value: totalRam > 0 ? formatBytes(totalRam) : "0 MB",
      icon: MemoryStick,
      tone: "text-info",
      sub: runningCount > 0 ? "Pohon proses aktif" : null,
      onClick: undefined,
    },
    {
      label: "node_modules",
      value: nmDisplay,
      icon: HardDrive,
      tone: "text-warn",
      sub: reclaimableSubtitle,
      isStorage: true,
      onClick: undefined,
    },
  ];

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

  return (
    <div className="animate-view-enter mx-auto max-w-6xl space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-fg">
            Overview
          </h1>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            <span className="font-mono tabular-nums">{projectCount}</span> project ·{" "}
            <span className="font-mono tabular-nums">{serviceCount}</span> service terdaftar
            {bootstrap ? (
              <>
                {" "}
                · Core v{bootstrap.version}
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {serviceCount > 0 ? (
            <div
              className="inline-flex rounded-[8px] border border-border bg-surface p-0.5 text-[12.5px]"
              role="tablist"
              aria-label="Filter service di Overview"
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
          ) : null}

          {onAddProject ? (
            <button
              type="button"
              onClick={onAddProject}
              className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[13px] font-semibold text-accent-fg hover:opacity-95"
            >
              <FolderPlus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              <span>Tambah Project</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* KPI Row (6 cards) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          const clickable = Boolean(kpi.onClick);
          return (
            <div
              key={kpi.label}
              onClick={kpi.onClick}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        kpi.onClick?.();
                      }
                    }
                  : undefined
              }
              className={cn(
                "rounded-[10px] border border-border bg-surface p-3.5",
                clickable &&
                  "cursor-pointer transition-colors hover:border-border-strong hover:bg-surface-hover/40",
              )}
            >
              <div className="flex items-center justify-between text-[12px] text-fg-muted">
                <span>{kpi.label}</span>
                <div className="flex items-center gap-1.5">
                  {"isStorage" in kpi && kpi.isStorage && serviceCount > 0 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void refreshGlobalStorage(true);
                      }}
                      aria-label="Hitung ulang storage global"
                      title="Hitung ulang storage"
                      className="rounded p-0.5 text-fg-faint hover:bg-surface-hover hover:text-fg"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${storageLoading ? "animate-spin" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                  ) : null}
                  <Icon
                    className={`h-3.5 w-3.5 ${kpi.tone}`}
                    strokeWidth={1.85}
                    aria-hidden="true"
                  />
                </div>
              </div>
              {"isStorage" in kpi && kpi.isStorage && storageLoading && nmDisplay === "—" ? (
                <div className="skeleton-shimmer mt-2 h-7 w-24 rounded-[6px]" />
              ) : (
                <div className="mt-2 font-mono text-[20px] font-semibold text-fg tabular-nums">
                  {kpi.value}
                </div>
              )}
              {kpi.sub ? (
                <div className="mt-0.5 truncate font-mono text-[10.5px] text-fg-faint tabular-nums">
                  {kpi.sub}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Multi-service Projects strip */}
      {multiServiceProjects.length > 0 ? (
        <section className="space-y-2.5">
          <h2 className="text-[12px] font-semibold tracking-wider text-fg-faint uppercase">
            Projects
          </h2>
          <div className="space-y-2">
            {multiServiceProjects.map((proj) => {
              const projMetrics = metrics?.byProject[proj.id];
              const runningInProj = proj.services.filter((s) =>
                procList.some(
                  (p) =>
                    p.serviceId === s.id &&
                    (p.status === "running" ||
                      p.status === "starting" ||
                      p.status === "restarting"),
                ),
              ).length;
              return (
                <div
                  key={proj.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border bg-surface px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-semibold text-fg">
                        {proj.name}
                      </span>
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-muted tabular-nums">
                        {runningInProj}/{proj.services.length} jalan
                      </span>
                      {projMetrics && projMetrics.currentMemoryBytes > 0 ? (
                        <span className="font-mono text-[11px] text-fg-faint tabular-nums">
                          {projMetrics.currentCpuPercent.toFixed(1)}% ·{" "}
                          {formatBytes(projMetrics.currentMemoryBytes)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-muted">
                      {proj.services.map((svc, idx) => (
                        <span key={svc.id} className="inline-flex items-center gap-1">
                          <span className="font-mono text-fg-2">
                            {idx + 1}. {svc.name}
                            {svc.port !== null ? ` :${svc.port}` : ""}
                          </span>
                          {idx < proj.services.length - 1 ? (
                            <ArrowRight
                              className="h-3 w-3 text-fg-faint"
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRoute({ kind: "project", projectId: proj.id })}
                    className="btn-press h-7 rounded-[6px] border border-border-strong bg-surface-2 px-2.5 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                  >
                    Buka Project
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Service cards grid OR Empty state */}
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
                Tambahkan folder project Node.js untuk mendeteksi package manager, framework, dan daftar script secara otomatis.
              </p>
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
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-semibold tracking-wider text-fg-faint uppercase">
              Services ({filteredCards.length})
            </h2>
          </div>

          {filteredCards.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-border bg-surface p-8 text-center text-[13px] text-fg-muted">
              Tidak ada service yang cocok dengan filter{" "}
              <span className="font-medium text-fg">
                {filter === "running" ? "Jalan" : "Bermasalah"}
              </span>
              .
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {filteredCards.map((item) => {
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

                        {/* Status pill with text (not color alone) */}
                        {item.status === "running" ? (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-accent"
                              aria-hidden="true"
                            />
                            Running
                          </span>
                        ) : item.status === "restarting" ? (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
                            <span
                              className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn"
                              aria-hidden="true"
                            />
                            Restarting
                          </span>
                        ) : item.status === "crashed" ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            Crashed
                          </span>
                        ) : item.status === "conflict" ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
                            <Network className="h-3 w-3" aria-hidden="true" />
                            Bentrok Port
                          </span>
                        ) : item.status === "missing" ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
                            Missing
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                            Stopped
                          </span>
                        )}
                      </div>

                      {/* Live CPU/RAM + Sparkline */}
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-[8px] border border-border bg-surface-2 px-3 py-2">
                        <div className="space-y-0.5 font-mono text-[11.5px] tabular-nums">
                          <div className="text-fg-2">
                            CPU <span className="font-semibold text-fg">{currentCpu.toFixed(1)}%</span>
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

                      {/* Issue detail snippet */}
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

                    {/* Footer actions */}
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

                      <div className="flex items-center gap-1.5">
                        {item.activeProcesses.length > 0 ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                openLogsForProcess(item.activeProcesses[0].id)
                              }
                              aria-label={`Lihat log ${item.service.name}`}
                              className="btn-press inline-flex h-7 items-center rounded-[6px] border border-border-strong bg-surface-2 px-2 text-fg-muted hover:bg-surface-hover hover:text-fg"
                            >
                              <TerminalSquare className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              disabled={busyId === item.service.id}
                              onClick={() =>
                                void handleQuickStop(
                                  item.service.id,
                                  item.activeProcesses,
                                )
                              }
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
                        ) : !item.service.isMissing ? (
                          <button
                            type="button"
                            disabled={busyId === item.service.id}
                            onClick={() =>
                              void handleQuickRun(
                                item.service,
                                item.latestCrashed?.script,
                              )
                            }
                            className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] bg-accent px-2.5 text-[11.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-45"
                          >
                            <Play className="h-3 w-3 fill-current" aria-hidden="true" />
                            <span>
                              {item.status === "crashed" ? "Jalankan lagi" : "Start"}
                            </span>
                          </button>
                        ) : null}
                      </div>
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
