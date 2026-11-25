import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Eye,
  EyeOff,
  FolderGit2,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Network,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Settings,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  FRAMEWORK_LABELS,
  type ProcessInfo,
  type Project,
  type ProjectEnvSummary,
  type ProjectStorageSummary,
  analyzeProjectStorage,
  attachPresetToProject,
  detachPresetFromProject,
  inspectProjectSharedEnv,
  openExternalUrl,
  reorderProjectPresets,
  testProjectDbConnection,
} from "@/lib/tauri";
import { DbTestButton } from "@/components/workbench/DbTestButton";
import { formatBytes } from "@/lib/format";
import { useAppStore } from "@/store/appStore";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MetricChartCard } from "@/components/ui/MetricChart";
import { cn } from "@/lib/cn";

interface ProjectOverviewViewProps {
  project: Project;
}

type ProjectTab = "services" | "env" | "storage";

function resolveFallbackScript(scripts: Record<string, string>, defaultScript: string | null): string | null {
  if (defaultScript && scripts[defaultScript]) return defaultScript;
  for (const preferred of ["dev", "start:dev", "serve", "start"]) {
    if (scripts[preferred]) return preferred;
  }
  return Object.keys(scripts)[0] ?? null;
}

export function ProjectOverviewView({ project }: ProjectOverviewViewProps) {
  const setRoute = useAppStore((s) => s.setRoute);
  const openAddProjectModal = useAppStore((s) => s.openAddProjectModal);
  const removeProject = useAppStore((s) => s.removeProject);
  const renameProject = useAppStore((s) => s.renameProject);
  const setServiceDefaultScript = useAppStore((s) => s.setServiceDefaultScript);
  const reorderProjectServices = useAppStore((s) => s.reorderProjectServices);
  const startProjectAll = useAppStore((s) => s.startProjectAll);
  const stopProjectAll = useAppStore((s) => s.stopProjectAll);
  const restartProjectAll = useAppStore((s) => s.restartProjectAll);
  const cleanProjectBuildCaches = useAppStore((s) => s.cleanProjectBuildCaches);
  const runScript = useAppStore((s) => s.runScript);
  const stopProcess = useAppStore((s) => s.stopProcess);
  const allPresets = useAppStore((s) => s.presets);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const processes = useAppStore((s) => s.processes);
  const metrics = useAppStore((s) => s.metrics);
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const orchestrationSteps = useAppStore((s) => s.orchestrationSteps[project.id]);
  const isOrchestrating = useAppStore((s) => Boolean(s.orchestratingProjectIds[project.id]));
  const pushToast = useAppStore((s) => s.pushToast);

  const [activeTab, setActiveTab] = useState<ProjectTab>("services");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmCleanCacheOpen, setConfirmCleanCacheOpen] = useState(false);
  const [storage, setStorage] = useState<ProjectStorageSummary | null>(null);
  const [storageRefreshing, setStorageRefreshing] = useState(false);
  const [sharedEnv, setSharedEnv] = useState<ProjectEnvSummary | null>(null);
  const [selectedPresetToAdd, setSelectedPresetToAdd] = useState("");
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState(project.name);
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [chartsPaused, setChartsPaused] = useState(false);
  const [frozenMetrics, setFrozenMetrics] = useState<
    { cpu: number[]; ram: number[]; currentCpu: number; currentRam: number } | null
  >(null);

  useEffect(() => {
    setProjectNameInput(project.name);
  }, [project.id, project.name]);

  const loadStorage = useCallback(
    async (forceRefresh = false) => {
      setStorageRefreshing(true);
      try {
        const res = await analyzeProjectStorage(project.id, forceRefresh);
        setStorage(res);
      } catch {
        // Non-fatal
      } finally {
        setStorageRefreshing(false);
      }
    },
    [project.id],
  );

  const loadSharedEnv = useCallback(async () => {
    try {
      const res = await inspectProjectSharedEnv(project.id);
      setSharedEnv(res);
    } catch {
      // Non-fatal
    }
  }, [project.id]);

  useEffect(() => {
    void loadStorage(false);
  }, [loadStorage]);

  useEffect(() => {
    void loadSharedEnv();
  }, [loadSharedEnv]);

  const procList = useMemo(() => Object.values(processes), [processes]);

  const serviceStatusMap = useMemo(() => {
    const map = new Map<
      string,
      {
        active: ProcessInfo[];
        latestCrashed: ProcessInfo | null;
        state: "running" | "starting" | "stopping" | "crashed" | "stopped";
      }
    >();
    for (const svc of project.services) {
      const svcProcs = procList
        .filter((p) => p.serviceId === svc.id)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const active = svcProcs.filter(
        (p) =>
          p.status === "running" ||
          p.status === "starting" ||
          p.status === "restarting" ||
          p.status === "stopping",
      );
      const latestCrashed =
        active.length === 0 ? (svcProcs.find((p) => p.status === "crashed") ?? null) : null;
      const state = active.some((p) => p.status === "stopping")
        ? "stopping"
        : active.some((p) => p.status === "starting" || p.status === "restarting")
          ? "starting"
          : active.length > 0
            ? "running"
            : latestCrashed
              ? "crashed"
              : "stopped";
      map.set(svc.id, { active, latestCrashed, state });
    }
    return map;
  }, [project.services, procList]);

  const runningCount = useMemo(
    () =>
      project.services.filter((s) => {
        const st = serviceStatusMap.get(s.id)?.state;
        return st === "running" || st === "starting" || st === "stopping";
      }).length,
    [project.services, serviceStatusMap],
  );

  const crashedCount = useMemo(
    () =>
      project.services.filter((s) => serviceStatusMap.get(s.id)?.state === "crashed").length,
    [project.services, serviceStatusMap],
  );

  const aggregateBadge = useMemo(() => {
    const total = project.services.length;
    if (total > 0 && runningCount === total) {
      return {
        label: `${runningCount}/${total} running`,
        cls: "bg-accent-soft text-accent",
      };
    }
    if (runningCount > 0) {
      return {
        label: `partial (${runningCount}/${total})`,
        cls: "bg-warn-soft text-warn",
      };
    }
    if (crashedCount > 0) {
      return {
        label: `crash (${crashedCount})`,
        cls: "bg-danger-soft text-danger",
      };
    }
    return {
      label: `stopped (0/${total})`,
      cls: "bg-surface-2 text-fg-muted",
    };
  }, [project.services.length, runningCount, crashedCount]);

  const liveProjectMetrics = metrics?.byProject[project.id];
  const chartData = useMemo(() => {
    if (chartsPaused && frozenMetrics) {
      return frozenMetrics;
    }
    const history = liveProjectMetrics?.history ?? [];
    return {
      cpu: history.map((p) => p.cpuPercent),
      ram: history.map((p) => p.memoryBytes),
      currentCpu: liveProjectMetrics?.currentCpuPercent ?? 0,
      currentRam: liveProjectMetrics?.currentMemoryBytes ?? 0,
    };
  }, [chartsPaused, frozenMetrics, liveProjectMetrics]);

  const handleToggleChartsPause = () => {
    if (!chartsPaused) {
      setFrozenMetrics(chartData);
      setChartsPaused(true);
    } else {
      setChartsPaused(false);
      setFrozenMetrics(null);
    }
  };

  const attachedIds = new Set((sharedEnv?.presets ?? []).map((p) => p.presetId));
  const availablePresets = allPresets.filter((p) => !attachedIds.has(p.id));

  const handleMoveServiceOrder = async (index: number, direction: -1 | 1) => {
    const list = [...project.services];
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const [moved] = list.splice(index, 1);
    list.splice(target, 0, moved);
    try {
      await reorderProjectServices(
        project.id,
        list.map((s) => s.id),
      );
    } catch (err) {
      pushToast({
        title: "Failed to update start order",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleDefaultScriptChange = async (serviceId: string, script: string) => {
    try {
      await setServiceDefaultScript(serviceId, script || null);
    } catch (err) {
      pushToast({
        title: "Failed to save default script",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleRunSingleService = async (serviceId: string, script: string) => {
    setBusyServiceId(serviceId);
    try {
      await runScript(serviceId, script);
    } catch (err) {
      pushToast({
        title: "Failed to start service",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusyServiceId(null);
    }
  };

  const handleStopSingleService = async (serviceId: string, active: ProcessInfo[]) => {
    setBusyServiceId(serviceId);
    try {
      for (const proc of active) {
        await stopProcess(proc.id);
      }
    } catch (err) {
      pushToast({
        title: "Failed to stop service",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusyServiceId(null);
    }
  };

  const handleAttachPreset = async () => {
    if (!selectedPresetToAdd) return;
    try {
      await attachPresetToProject(project.id, selectedPresetToAdd);
      setSelectedPresetToAdd("");
      await Promise.all([loadSharedEnv(), loadPresets()]);
      pushToast({
        title: `Preset attached to ${project.name}`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "Failed to attach preset",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleDetachPreset = async (presetId: string, presetName: string) => {
    try {
      await detachPresetFromProject(project.id, presetId);
      await Promise.all([loadSharedEnv(), loadPresets()]);
      pushToast({
        title: `Detached "${presetName}" from ${project.name}`,
        variant: "info",
      });
    } catch (err) {
      pushToast({
        title: "Failed to detach preset",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleMovePreset = async (index: number, direction: -1 | 1) => {
    if (!sharedEnv) return;
    const list = [...sharedEnv.presets];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const [moved] = list.splice(index, 1);
    list.splice(targetIndex, 0, moved);
    try {
      await reorderProjectPresets(
        project.id,
        list.map((p) => p.presetId),
      );
      await loadSharedEnv();
    } catch (err) {
      pushToast({
        title: "Failed to reorder presets",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleRenameProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectNameInput.trim() || projectNameInput.trim() === project.name) return;
    try {
      await renameProject(project.id, projectNameInput.trim());
    } catch (err) {
      pushToast({
        title: "Failed to rename project",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const projectTypeLabel = project.rootPath ? "monorepo" : "multi-folder";

  return (
    <div className="animate-view-enter flex h-full min-h-0">
      {/* Main left column */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="w-full space-y-5">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[19px] font-semibold tracking-tight text-fg">
                  {project.name}
                </h1>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium tabular-nums",
                    aggregateBadge.cls,
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      runningCount === project.services.length
                        ? "bg-accent"
                        : runningCount > 0
                          ? "bg-warn"
                          : crashedCount > 0
                            ? "bg-danger"
                            : "bg-fg-faint",
                    )}
                    aria-hidden="true"
                  />
                  {aggregateBadge.label}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-muted">
                  <FolderGit2 className="h-3 w-3 text-info" aria-hidden="true" />
                  {projectTypeLabel}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
                <span className="font-mono tabular-nums">
                  {project.services.length} services
                </span>
                <span>·</span>
                <span className="font-mono tabular-nums">
                  {sharedEnv?.presets.length ?? 0} shared {(sharedEnv?.presets.length ?? 0) === 1 ? "preset" : "presets"}
                </span>
                <span>·</span>
                <span className="truncate font-mono text-[11.5px] text-fg-faint">
                  Order:{" "}
                  {project.services
                    .map((s, idx) => `${idx + 1}. ${s.name}`)
                    .join(" → ")}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openAddProjectModal(project.id)}
                className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Service</span>
              </button>

              {runningCount > 0 ? (
                <>
                  <button
                    type="button"
                    disabled={isOrchestrating}
                    onClick={() => void restartProjectAll(project.id)}
                    className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                  >
                    <RotateCw
                      className={cn("h-3.5 w-3.5", isOrchestrating && "animate-spin")}
                      aria-hidden="true"
                    />
                    <span>Restart All</span>
                  </button>
                  <button
                    type="button"
                    disabled={isOrchestrating}
                    onClick={() => void stopProjectAll(project.id)}
                    className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-danger-solid px-3 text-[12.5px] font-semibold text-white hover:opacity-95 disabled:opacity-50"
                  >
                    <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                    <span>Stop All</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={isOrchestrating || project.services.length === 0}
                  onClick={() => void startProjectAll(project.id)}
                  className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-50"
                >
                  {isOrchestrating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  )}
                  <span>{isOrchestrating ? "Starting…" : "Start All"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-border" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "services"}
              onClick={() => setActiveTab("services")}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors",
                activeTab === "services"
                  ? "text-fg after:absolute after:right-0 after:bottom-0 after:left-0 after:h-[2px] after:bg-info"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Services</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "env"}
              onClick={() => setActiveTab("env")}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors",
                activeTab === "env"
                  ? "text-fg after:absolute after:right-0 after:bottom-0 after:left-0 after:h-[2px] after:bg-info"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Shared Env & Presets</span>
              {sharedEnv && sharedEnv.presets.length > 0 ? (
                <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted tabular-nums">
                  {sharedEnv.presets.length}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "storage"}
              onClick={() => setActiveTab("storage")}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors",
                activeTab === "storage"
                  ? "text-fg after:absolute after:right-0 after:bottom-0 after:left-0 after:h-[2px] after:bg-info"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Storage & Settings</span>
            </button>
          </div>

          {activeTab === "services" ? (
            <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-[11.5px] font-semibold tracking-wide text-fg-muted uppercase">
                    <th className="px-3 py-2.5">Order</th>
                    <th className="px-3 py-2.5">Service</th>
                    <th className="px-3 py-2.5">Default Script</th>
                    <th className="px-3 py-2.5">Port</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {project.services.map((svc, index) => {
                    const scriptNames = Object.keys(svc.scripts);
                    const effectiveDefault =
                      resolveFallbackScript(svc.scripts, svc.defaultScript) ?? "";
                    const statusEntry = serviceStatusMap.get(svc.id);
                    const orchStep = orchestrationSteps?.[svc.id];
                    const activeProcs = statusEntry?.active ?? [];
                    const isBusy = busyServiceId === svc.id;

                    return (
                      <tr
                        key={svc.id}
                        className="transition-colors hover:bg-surface-hover/40"
                      >
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            <span className="w-6 font-mono text-[12px] text-fg-faint tabular-nums">
                              #{index + 1}
                            </span>
                            <button
                              type="button"
                              aria-label={`Move ${svc.name} up in start order`}
                              disabled={index === 0 || isOrchestrating}
                              onClick={() => void handleMoveServiceOrder(index, -1)}
                              className="flex h-6 w-6 items-center justify-center rounded border border-border bg-surface-2 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-30"
                            >
                              <ArrowUp className="h-3 w-3" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Move ${svc.name} down in start order`}
                              disabled={
                                index === project.services.length - 1 || isOrchestrating
                              }
                              onClick={() => void handleMoveServiceOrder(index, 1)}
                              className="flex h-6 w-6 items-center justify-center rounded border border-border bg-surface-2 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-30"
                            >
                              <ArrowDown className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2 font-medium text-fg">
                            <span>{svc.name}</span>
                            {svc.isMissing ? (
                              <span className="inline-flex items-center gap-1 rounded bg-warn-soft px-1.5 py-0.5 text-[10.5px] text-warn">
                                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                missing
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-[11.5px] text-fg-muted">
                            {FRAMEWORK_LABELS[svc.detectedFramework]} ·{" "}
                            <span className="font-mono">
                              {svc.pmOverride ?? svc.detectedPm}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {scriptNames.length > 0 ? (
                            <select
                              aria-label={`Default script for ${svc.name}`}
                              value={svc.defaultScript ?? effectiveDefault}
                              onChange={(e) =>
                                void handleDefaultScriptChange(svc.id, e.target.value)
                              }
                              className="h-7 rounded-[6px] border border-border-strong bg-surface-2 px-2 font-mono text-[11.5px] text-fg"
                            >
                              {scriptNames.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-[11.5px] text-fg-faint">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 font-mono text-[12px] text-info tabular-nums">
                          {(() => {
                            const route = proxyStatus?.routes.find(
                              (r) => r.serviceId === svc.id,
                            );
                            const isUp = statusEntry?.state === "running";
                            return (
                              <div className="flex flex-col items-start gap-1">
                                <span>
                                  {svc.port !== null ? `:${svc.port}` : "auto"}
                                </span>
                                {proxyStatus?.running && route && isUp ? (
                                  <button
                                    type="button"
                                    onClick={() => void openExternalUrl(route.url)}
                                    className="inline-flex items-center gap-1 rounded bg-info-soft px-1.5 py-0.5 text-[10.5px] font-medium text-info hover:opacity-90"
                                  >
                                    <Globe className="h-2.5 w-2.5" aria-hidden="true" />
                                    <span>{route.domain}</span>
                                  </button>
                                ) : null}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-3">
                          {isOrchestrating && orchStep ? (
                            orchStep.state === "waiting" ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-muted">
                                waiting…
                              </span>
                            ) : orchStep.state === "starting" ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-2 py-0.5 font-mono text-[11px] text-info">
                                <span
                                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-info"
                                  aria-hidden="true"
                                />
                                starting…
                              </span>
                            ) : orchStep.state === "stopping" ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2 py-0.5 font-mono text-[11px] text-warn">
                                stopping…
                              </span>
                            ) : orchStep.state === "failed" ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger"
                                title={orchStep.error ?? undefined}
                              >
                                failed
                              </span>
                            ) : orchStep.state === "skipped" ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn">
                                skipped
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] text-accent">
                                running
                              </span>
                            )
                          ) : statusEntry?.state === "running" ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-accent"
                                aria-hidden="true"
                              />
                              running
                            </span>
                          ) : statusEntry?.state === "starting" ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-medium text-info">
                              starting…
                            </span>
                          ) : statusEntry?.state === "crashed" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">
                              crashed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                              stopped
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {activeProcs.length > 0 ? (
                              <button
                                type="button"
                                disabled={isBusy || isOrchestrating}
                                onClick={() =>
                                  void handleStopSingleService(svc.id, activeProcs)
                                }
                                className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-danger/45 bg-danger-soft px-2 text-[11.5px] font-medium text-danger hover:bg-danger-solid hover:text-white disabled:opacity-45"
                              >
                                <Square
                                  className="h-2.5 w-2.5 fill-current"
                                  aria-hidden="true"
                                />
                                <span>Stop</span>
                              </button>
                            ) : !svc.isMissing && effectiveDefault ? (
                              <button
                                type="button"
                                disabled={isBusy || isOrchestrating}
                                onClick={() =>
                                  void handleRunSingleService(svc.id, effectiveDefault)
                                }
                                className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] bg-accent px-2 text-[11.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-45"
                              >
                                <Play
                                  className="h-2.5 w-2.5 fill-current"
                                  aria-hidden="true"
                                />
                                <span>Run</span>
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() =>
                                setRoute({
                                  kind: "service",
                                  projectId: project.id,
                                  serviceId: svc.id,
                                })
                              }
                              className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-border-strong bg-surface-2 px-2.5 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                            >
                              <span>Configure</span>
                              <ArrowRight className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : activeTab === "env" ? (
            <div className="space-y-4">
              {/* Attached Project Presets */}
              <div className="rounded-[10px] border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-[13.5px] font-semibold text-fg">
                      Project Presets (Inherited by All Services)
                    </h2>
                    <p className="mt-0.5 text-[12px] text-fg-muted">
                      Presets lower in the list take higher precedence when keys overlap.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Select preset to attach to project"
                      value={selectedPresetToAdd}
                      onChange={(e) => setSelectedPresetToAdd(e.target.value)}
                      className="h-8 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[12px] text-fg"
                    >
                      <option value="">Select preset…</option>
                      {availablePresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.entries.length} {p.entries.length === 1 ? "key" : "keys"})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!selectedPresetToAdd}
                      onClick={() => void handleAttachPreset()}
                      className="btn-press inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-45"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Attach Preset</span>
                    </button>
                  </div>
                </div>

                {!sharedEnv || sharedEnv.presets.length === 0 ? (
                  <div className="mt-3 rounded-[8px] border border-dashed border-border p-4 text-center text-[12.5px] text-fg-muted">
                    No shared presets attached yet.{" "}
                    <button
                      type="button"
                      onClick={() => setRoute({ kind: "presets" })}
                      className="font-medium text-info hover:underline"
                    >
                      Manage Env Presets →
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 space-y-1.5">
                    {sharedEnv.presets.map((preset, idx) => (
                      <div
                        key={preset.presetId}
                        className="flex items-center justify-between gap-2 rounded-[8px] border border-border bg-surface-2 px-3 py-2"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-[11.5px] text-fg-faint tabular-nums">
                            #{idx + 1}
                          </span>
                          <span className="text-[13px] font-medium text-fg">
                            {preset.presetName}
                          </span>
                          <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted tabular-nums">
                            {preset.entryCount} {preset.entryCount === 1 ? "key" : "keys"}
                          </span>
                          {preset.secretCount > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded bg-warn-soft px-1.5 py-0.5 font-mono text-[10.5px] text-warn tabular-nums">
                              <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                              {preset.secretCount} Keychain
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`Move ${preset.presetName} up`}
                            disabled={idx === 0}
                            onClick={() => void handleMovePreset(idx, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-35"
                          >
                            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${preset.presetName} down`}
                            disabled={idx === sharedEnv.presets.length - 1}
                            onClick={() => void handleMovePreset(idx, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-35"
                          >
                            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Detach preset ${preset.presetName}`}
                            onClick={() =>
                              void handleDetachPreset(preset.presetId, preset.presetName)
                            }
                            className="flex h-7 items-center gap-1 rounded-[6px] border border-danger/30 bg-danger-soft px-2 text-[11.5px] font-medium text-danger hover:bg-danger-solid hover:text-white"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                            <span>Detach</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Merged Shared Env Preview */}
              {sharedEnv && sharedEnv.entries.length > 0 ? (
                <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <span className="text-[12.5px] font-semibold text-fg">
                      Shared Env Preview ({sharedEnv.entries.length} {sharedEnv.entries.length === 1 ? "key" : "keys"})
                    </span>
                    <button
                      type="button"
                      onClick={() => setRevealSecrets((v) => !v)}
                      className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-border-strong bg-surface-2 px-2 text-[11.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                    >
                      {revealSecrets ? (
                        <>
                          <EyeOff className="h-3 w-3" aria-hidden="true" />
                          <span>Hide</span>
                        </>
                      ) : (
                        <>
                          <Eye className="h-3 w-3" aria-hidden="true" />
                          <span>Reveal Secrets</span>
                        </>
                      )}
                    </button>
                  </div>
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border bg-surface-2 text-[11.5px] font-semibold tracking-wide text-fg-muted uppercase">
                        <th className="px-4 py-2">Key</th>
                        <th className="px-4 py-2">Value</th>
                        <th className="px-4 py-2">Source Preset</th>
                        <th className="px-4 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-[12.5px]">
                      {sharedEnv.entries.map((entry) => (
                        <tr key={entry.key}>
                          <td className="px-4 py-2 font-mono font-medium text-fg">
                            <div className="flex items-center gap-1.5">
                              <span>{entry.key}</span>
                              {entry.isSecret ? (
                                <span className="inline-flex items-center gap-0.5 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn">
                                  <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                                  secret
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2 font-mono text-[12px] text-fg-2">
                            {entry.isSecret && !revealSecrets ? "••••••••" : entry.value}
                          </td>
                          <td className="px-4 py-2">
                            <span className="rounded bg-info-soft px-1.5 py-0.5 font-mono text-[11px] text-info">
                              project:{entry.source}
                            </span>
                            {entry.overriddenSources.length > 0 ? (
                              <span className="ml-1.5 text-[10.5px] text-fg-faint">
                                (overrides {entry.overriddenSources.join(", ")})
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {entry.detectedDbKind ? (
                              <DbTestButton
                                envKey={entry.key}
                                onTest={() =>
                                  testProjectDbConnection(project.id, entry.key)
                                }
                              />
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Aggregated Storage */}
              <div className="rounded-[10px] border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-fg">
                      <HardDrive className="h-4 w-4 text-warn" aria-hidden="true" />
                      <span>Combined Project Storage</span>
                    </h2>
                    <p className="mt-0.5 text-[12px] text-fg-muted">
                      Total disk usage across all services including cleanable build cache folders.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={storageRefreshing}
                      onClick={() => void loadStorage(true)}
                      className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                    >
                      <RefreshCw
                        className={cn("h-3.5 w-3.5", storageRefreshing && "animate-spin")}
                        aria-hidden="true"
                      />
                      <span>Recalculate</span>
                    </button>
                    <button
                      type="button"
                      disabled={!storage || storage.buildCacheBytes === 0}
                      onClick={() => setConfirmCleanCacheOpen(true)}
                      className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-warn/40 bg-warn-soft px-3 text-[12px] font-medium text-warn hover:opacity-90 disabled:opacity-45"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Clean Build Caches</span>
                    </button>
                  </div>
                </div>

                {storage ? (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      <div className="rounded-[8px] border border-border bg-surface-2 p-2.5">
                        <div className="text-[11px] text-fg-muted">Total</div>
                        <div className="mt-1 font-mono text-[14px] font-semibold text-fg tabular-nums">
                          {formatBytes(storage.totalBytes)}
                        </div>
                      </div>
                      <div className="rounded-[8px] border border-border bg-surface-2 p-2.5">
                        <div className="text-[11px] text-fg-muted">node_modules</div>
                        <div className="mt-1 font-mono text-[14px] font-semibold text-warn tabular-nums">
                          {formatBytes(storage.nodeModulesBytes)}
                        </div>
                      </div>
                      <div className="rounded-[8px] border border-border bg-surface-2 p-2.5">
                        <div className="text-[11px] text-fg-muted">Build & Cache</div>
                        <div className="mt-1 font-mono text-[14px] font-semibold text-info tabular-nums">
                          {formatBytes(storage.buildCacheBytes)}
                        </div>
                      </div>
                      <div className="rounded-[8px] border border-border bg-surface-2 p-2.5">
                        <div className="text-[11px] text-fg-muted">Source</div>
                        <div className="mt-1 font-mono text-[14px] font-semibold text-fg-2 tabular-nums">
                          {formatBytes(storage.sourceBytes)}
                        </div>
                      </div>
                    </div>

                    <div className="divide-y divide-border rounded-[8px] border border-border">
                      {storage.services.map((svcRep) => (
                        <div
                          key={svcRep.serviceId}
                          className="flex items-center justify-between px-3 py-2 text-[12.5px]"
                        >
                          <span className="font-medium text-fg">{svcRep.serviceName}</span>
                          <div className="flex items-center gap-3 font-mono text-[11.5px] tabular-nums">
                            <span className="text-warn">
                              nm {formatBytes(svcRep.nodeModulesBytes)}
                            </span>
                            <span className="text-info">
                              cache {formatBytes(svcRep.buildCacheBytes)}
                            </span>
                            <span className="font-semibold text-fg">
                              {formatBytes(svcRep.totalBytes)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="skeleton-shimmer mt-3 h-24 rounded-[8px]" />
                )}
              </div>

              {/* Rename Project */}
              <form
                onSubmit={(e) => void handleRenameProject(e)}
                className="rounded-[10px] border border-border bg-surface p-4"
              >
                <label
                  htmlFor="project-rename-input"
                  className="text-[13px] font-semibold text-fg"
                >
                  Project Name
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="project-rename-input"
                    type="text"
                    value={projectNameInput}
                    onChange={(e) => setProjectNameInput(e.target.value)}
                    className="h-8 flex-1 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[13px] text-fg focus:border-info focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg hover:bg-surface-hover"
                  >
                    Save
                  </button>
                </div>
              </form>

              {/* Danger Zone */}
              <div className="rounded-[10px] border border-danger/35 bg-surface p-4">
                <h3 className="text-[13px] font-semibold text-danger">
                  Remove Project from DevDock
                </h3>
                <p className="mt-0.5 text-[12px] text-fg-muted">
                  Removing a project only removes it from DevDock. Folders and code files on disk will not be touched.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  className="btn-press mt-3 flex h-8 items-center gap-1.5 rounded-[7px] bg-danger-solid px-3 text-[12.5px] font-semibold text-white hover:opacity-95"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Remove Project</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Inspector (280px) */}
      <aside className="hidden w-[280px] shrink-0 overflow-y-auto border-l border-border bg-bg-sidebar p-4 xl:block">
        <h2 className="text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
          Live Monitoring
        </h2>
        <div className="mt-3 space-y-2.5">
          <MetricChartCard
            title="Project Total CPU"
            currentText={`${chartData.currentCpu.toFixed(1)}%`}
            peakText={`${Math.max(0, ...chartData.cpu).toFixed(1)}%`}
            statusText={runningCount > 0 ? "Active · 2s" : "Idle"}
            values={chartData.cpu}
            strokeColorVar="var(--info)"
            paused={chartsPaused}
            onTogglePause={handleToggleChartsPause}
          />
          <MetricChartCard
            title="Project Total RAM"
            currentText={
              chartData.currentRam > 0 ? formatBytes(chartData.currentRam) : "0 MB"
            }
            peakText={
              Math.max(0, ...chartData.ram) > 0
                ? formatBytes(Math.max(0, ...chartData.ram))
                : "0 MB"
            }
            statusText={runningCount > 0 ? "Active · 2s" : "Idle"}
            values={chartData.ram}
            strokeColorVar="var(--accent)"
            paused={chartsPaused}
            onTogglePause={handleToggleChartsPause}
          />
        </div>

        <h2 className="mt-5 text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
          Service Ports
        </h2>
        <div className="mt-3 space-y-1.5 rounded-[10px] border border-border bg-surface p-3 text-[12px]">
          {project.services.map((svc) => {
            const isUp = serviceStatusMap.get(svc.id)?.state === "running";
            return (
              <div
                key={svc.id}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate text-fg-2">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      isUp ? "bg-accent" : "bg-fg-faint/60",
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{svc.name}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 font-mono text-info tabular-nums">
                  <Network className="h-3 w-3" aria-hidden="true" />
                  {svc.port !== null ? `:${svc.port}` : "auto"}
                </span>
              </div>
            );
          })}
        </div>

        <h2 className="mt-5 text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
          Combined Storage
        </h2>
        <div className="mt-3 space-y-2 rounded-[10px] border border-border bg-surface p-3.5 text-[12.5px]">
          {storage ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Total</span>
                <span className="font-mono font-semibold text-fg tabular-nums">
                  {formatBytes(storage.totalBytes)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">node_modules</span>
                <span className="font-mono text-warn tabular-nums">
                  {formatBytes(storage.nodeModulesBytes)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Build & Cache</span>
                <span className="font-mono text-info tabular-nums">
                  {formatBytes(storage.buildCacheBytes)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("storage")}
                className="btn-press mt-2 w-full rounded-[6px] border border-border-strong bg-surface-2 py-1.5 text-center text-[11.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
              >
                Manage Storage
              </button>
            </>
          ) : (
            <div className="skeleton-shimmer h-16 rounded-[6px]" />
          )}
        </div>
      </aside>

      <ConfirmDialog
        open={confirmOpen}
        title={`Remove project "${project.name}"?`}
        description="Removing this project only removes it from DevDock. Folders and code files on disk will not be touched."
        confirmLabel="Remove from DevDock"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void removeProject(project.id);
        }}
      />
      <ConfirmDialog
        open={confirmCleanCacheOpen}
        title={`Clean build caches for ${project.name}?`}
        description="All build/cache folders (.next, dist, .turbo, .vite, etc.) across all services in this project will be deleted. node_modules and source code will not be touched."
        confirmLabel="Clean Build Caches"
        onCancel={() => setConfirmCleanCacheOpen(false)}
        onConfirm={() => {
          setConfirmCleanCacheOpen(false);
          void cleanProjectBuildCaches(project.id).then(() => loadStorage(true));
        }}
      />
    </div>
  );
}
