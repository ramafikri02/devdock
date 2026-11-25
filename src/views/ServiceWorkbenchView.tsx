import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FileCode2,
  FolderOpen,
  HardDrive,
  Layers,
  Package,
  Play,
  RefreshCw,
  RotateCw,
  Settings,
  Square,
  Terminal,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import {
  FRAMEWORK_LABELS,
  type PackageManager,
  type ProcessInfo,
  type Project,
  type Service,
  type ServiceStorageReport,
  analyzeServiceStorage,
  pickFolderDialog,
} from "@/lib/tauri";
import { formatBytes, formatDuration } from "@/lib/format";
import { useAppStore } from "@/store/appStore";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ServiceEnvTab } from "@/components/workbench/ServiceEnvTab";
import { ServiceStorageTab } from "@/components/workbench/ServiceStorageTab";
import { cn } from "@/lib/cn";

interface ServiceWorkbenchViewProps {
  project: Project;
  service: Service;
}

type WorkbenchTab = "scripts" | "env" | "storage" | "settings";

export function ServiceWorkbenchView({
  project,
  service,
}: ServiceWorkbenchViewProps) {
  const refreshService = useAppStore((s) => s.refreshService);
  const renameService = useAppStore((s) => s.renameService);
  const renameProject = useAppStore((s) => s.renameProject);
  const setPmOverride = useAppStore((s) => s.setPmOverride);
  const relocateService = useAppStore((s) => s.relocateService);
  const removeService = useAppStore((s) => s.removeService);
  const removeProject = useAppStore((s) => s.removeProject);
  const setRoute = useAppStore((s) => s.setRoute);
  const pushToast = useAppStore((s) => s.pushToast);
  const processes = useAppStore((s) => s.processes);
  const runScript = useAppStore((s) => s.runScript);
  const stopProcess = useAppStore((s) => s.stopProcess);
  const restartProcess = useAppStore((s) => s.restartProcess);
  const openLogsForProcess = useAppStore((s) => s.openLogsForProcess);

  const [tab, setTab] = useState<WorkbenchTab>("scripts");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [serviceNameInput, setServiceNameInput] = useState(service.name);
  const [projectNameInput, setProjectNameInput] = useState(project.name);
  const [relocateInput, setRelocateInput] = useState(service.path);
  const [confirmRemoveTarget, setConfirmRemoveTarget] = useState<
    "service" | "project" | null
  >(null);
  const [storageSummary, setStorageSummary] =
    useState<ServiceStorageReport | null>(null);

  useEffect(() => {
    setServiceNameInput(service.name);
    setProjectNameInput(project.name);
    setRelocateInput(service.path);
  }, [service.id, service.name, service.path, project.name]);

  useEffect(() => {
    if (service.isMissing) {
      setStorageSummary(null);
      return;
    }
    let cancelled = false;
    void analyzeServiceStorage(service.id, false)
      .then((rep) => {
        if (!cancelled) setStorageSummary(rep);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [service.id, service.isMissing]);

  const effectivePm = service.pmOverride ?? service.detectedPm;
  const scriptEntries = Object.entries(service.scripts);
  const isSingleServiceProject = project.services.length === 1;

  const serviceProcesses = useMemo(
    () =>
      Object.values(processes)
        .filter((p) => p.serviceId === service.id)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [processes, service.id],
  );

  const activeServiceProcesses = useMemo(
    () =>
      serviceProcesses.filter(
        (p) =>
          p.status === "running" ||
          p.status === "starting" ||
          p.status === "stopping",
      ),
    [serviceProcesses],
  );

  const processesByScript = useMemo(() => {
    const map = new Map<string, ProcessInfo[]>();
    for (const p of serviceProcesses) {
      const list = map.get(p.script) ?? [];
      list.push(p);
      map.set(p.script, list);
    }
    return map;
  }, [serviceProcesses]);

  const primaryScript =
    (service.defaultScript && service.scripts[service.defaultScript]
      ? service.defaultScript
      : scriptEntries[0]?.[0]) ?? null;

  const handleRunScript = async (scriptName: string) => {
    setBusyAction(`run:${scriptName}`);
    try {
      await runScript(service.id, scriptName);
    } catch (err) {
      pushToast({
        title: `Gagal menjalankan "${scriptName}"`,
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleStopProcess = async (processId: string) => {
    setBusyAction(`stop:${processId}`);
    try {
      await stopProcess(processId);
    } catch (err) {
      pushToast({
        title: "Gagal menghentikan proses",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestartProcess = async (processId: string) => {
    setBusyAction(`restart:${processId}`);
    try {
      await restartProcess(processId);
    } catch (err) {
      pushToast({
        title: "Gagal me-restart proses",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const latestServiceStatus =
    activeServiceProcesses.length > 0
      ? activeServiceProcesses.some((p) => p.status === "stopping")
        ? "stopping"
        : "running"
      : serviceProcesses[0]?.status === "crashed"
        ? "crashed"
        : "stopped";

  const handleRelocateWithPicker = async () => {
    const picked = await pickFolderDialog(`Relokasi folder untuk ${service.name}`);
    if (!picked) return;
    try {
      await relocateService(service.id, picked);
    } catch (err) {
      pushToast({
        title: "Gagal merelokasi folder",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleRelocateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relocateInput.trim()) return;
    try {
      await relocateService(service.id, relocateInput.trim());
    } catch (err) {
      pushToast({
        title: "Gagal merelokasi folder",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleRenameService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceNameInput.trim() || serviceNameInput.trim() === service.name) return;
    try {
      await renameService(service.id, serviceNameInput.trim());
    } catch (err) {
      pushToast({
        title: "Gagal mengganti nama service",
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
        title: "Gagal mengganti nama project",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  return (
    <div className="animate-view-enter flex h-full min-h-0">
      {/* Main left column */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-5">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[19px] font-semibold tracking-tight text-fg">
                  {service.name}
                </h1>
                {service.isMissing ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11.5px] font-medium text-warn">
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    Folder tidak ditemukan
                  </span>
                ) : latestServiceStatus === "running" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_6px_var(--accent)]"
                      aria-hidden="true"
                    />
                    Running ({activeServiceProcesses.length})
                  </span>
                ) : latestServiceStatus === "stopping" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2 py-0.5 text-[11.5px] font-medium text-warn">
                    <span
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn"
                      aria-hidden="true"
                    />
                    Stopping…
                  </span>
                ) : latestServiceStatus === "crashed" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] font-medium text-danger">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-danger"
                      aria-hidden="true"
                    />
                    Crashed
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-fg-muted">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-fg-faint"
                      aria-hidden="true"
                    />
                    Stopped
                  </span>
                )}
                {!isSingleServiceProject ? (
                  <button
                    type="button"
                    onClick={() =>
                      setRoute({ kind: "project", projectId: project.id })
                    }
                    className="rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-info hover:bg-surface-hover"
                  >
                    {project.name}
                  </button>
                ) : null}
              </div>

              {/* Metadata row */}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
                <span className="inline-flex items-center gap-1 rounded-[6px] bg-surface-2 px-2 py-0.5 font-medium text-fg-2">
                  <Layers className="h-3 w-3 text-info" aria-hidden="true" />
                  {FRAMEWORK_LABELS[service.detectedFramework]}
                </span>
                <span className="inline-flex items-center gap-1 rounded-[6px] bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-fg-2">
                  <Package className="h-3 w-3 text-accent" aria-hidden="true" />
                  {effectivePm}
                  {service.pmOverride ? (
                    <span className="text-info">(override)</span>
                  ) : null}
                </span>
                <span className="truncate font-mono text-[11.5px] text-fg-faint select-text">
                  {service.path}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!service.isMissing && primaryScript ? (
                activeServiceProcesses.length > 0 ? (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => {
                      for (const proc of activeServiceProcesses) {
                        void handleStopProcess(proc.id);
                      }
                    }}
                    className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-danger-solid px-3 text-[12.5px] font-semibold text-white hover:opacity-95 disabled:opacity-50"
                  >
                    <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleRunScript(primaryScript)}
                    className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    <span>Start ({primaryScript})</span>
                  </button>
                )
              ) : null}
              <button
                type="button"
                onClick={() => void refreshService(service.id)}
                className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Missing folder alert banner */}
          {service.isMissing ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-warn/40 bg-warn-soft p-3.5"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-warn"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-[13px] font-semibold text-fg">
                    Folder service tidak ditemukan di disk
                  </p>
                  <p className="mt-0.5 font-mono text-[11.5px] text-fg-muted">
                    {service.path}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleRelocateWithPicker()}
                  className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface px-3 text-[12.5px] font-medium text-fg hover:bg-surface-hover"
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Relokasi Folder</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemoveTarget("service")}
                  className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-danger-solid px-3 text-[12.5px] font-semibold text-white hover:opacity-95"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Hapus</span>
                </button>
              </div>
            </div>
          ) : null}

          {/* Tabs */}
          <div className="border-b border-border">
            <div className="flex gap-1" role="tablist" aria-label="Service Workbench tabs">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "scripts"}
                onClick={() => setTab("scripts")}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
                  tab === "scripts"
                    ? "border-info text-fg"
                    : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Scripts</span>
                <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted tabular-nums">
                  {scriptEntries.length}
                </span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={tab === "env"}
                onClick={() => setTab("env")}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
                  tab === "env"
                    ? "border-info text-fg"
                    : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Env</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={tab === "storage"}
                onClick={() => setTab("storage")}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
                  tab === "storage"
                    ? "border-info text-fg"
                    : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Storage</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={tab === "settings"}
                onClick={() => setTab("settings")}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
                  tab === "settings"
                    ? "border-info text-fg"
                    : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Settings</span>
              </button>
            </div>
          </div>

          {/* Tab content: Scripts */}
          {tab === "scripts" ? (
            <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
              {scriptEntries.length === 0 ? (
                <div className="p-6 text-center text-[13px] text-fg-muted">
                  {service.isMissing
                    ? "Folder tidak ditemukan. Relokasi folder untuk membaca scripts dari package.json."
                    : "Tidak ada script ditemukan di package.json."}
                </div>
              ) : (
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border bg-surface-2 text-[11.5px] font-semibold tracking-wide text-fg-muted uppercase">
                      <th className="px-4 py-2.5">Script</th>
                      <th className="px-4 py-2.5">Command</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-[13px]">
                    {scriptEntries.map(([name, cmd]) => {
                      const runs = processesByScript.get(name) ?? [];
                      const activeRuns = runs.filter(
                        (p) =>
                          p.status === "running" ||
                          p.status === "starting" ||
                          p.status === "stopping",
                      );
                      const activeRun = activeRuns[0] ?? null;
                      const latestRun = runs[0] ?? null;

                      return (
                        <tr
                          key={name}
                          className="transition-colors hover:bg-surface-hover/40"
                        >
                          <td className="px-4 py-2.5 font-mono font-medium text-fg">
                            <span className="flex items-center gap-2">
                              <span>{name}</span>
                              {service.defaultScript === name ? (
                                <span className="rounded bg-info-soft px-1.5 py-0.5 font-sans text-[10.5px] font-medium text-info">
                                  default
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td className="max-w-xs truncate px-4 py-2.5 font-mono text-[12px] text-fg-muted select-text">
                            {cmd}
                          </td>
                          <td className="px-4 py-2.5">
                            {activeRun ? (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                                    activeRun.status === "stopping"
                                      ? "bg-warn-soft text-warn"
                                      : "bg-accent-soft text-accent",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "h-1.5 w-1.5 rounded-full",
                                      activeRun.status === "stopping"
                                        ? "animate-pulse bg-warn"
                                        : "bg-accent",
                                    )}
                                    aria-hidden="true"
                                  />
                                  {activeRun.status === "stopping"
                                    ? "Stopping…"
                                    : activeRuns.length > 1
                                      ? `Running ×${activeRuns.length}`
                                      : "Running"}
                                </span>
                                {activeRun.pid ? (
                                  <span className="font-mono text-[11px] text-fg-faint tabular-nums">
                                    PID {activeRun.pid}
                                  </span>
                                ) : null}
                              </div>
                            ) : latestRun ? (
                              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] tabular-nums">
                                <span
                                  className={cn(
                                    "rounded px-1.5 py-0.5 font-medium",
                                    latestRun.status === "crashed"
                                      ? "bg-danger-soft text-danger"
                                      : "bg-surface-2 text-fg-muted",
                                  )}
                                >
                                  exit {latestRun.exitCode ?? "—"}
                                </span>
                                <span className="text-fg-faint">
                                  {formatDuration(latestRun.durationMs)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[11.5px] text-fg-faint">
                                Idle
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {activeRun ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={busyAction !== null}
                                    onClick={() =>
                                      void handleRestartProcess(activeRun.id)
                                    }
                                    title="Restart script"
                                    aria-label={`Restart ${name}`}
                                    className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-border-strong bg-surface-2 px-2 text-[11.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg disabled:opacity-45"
                                  >
                                    <RotateCw
                                      className="h-3 w-3"
                                      aria-hidden="true"
                                    />
                                    <span>Restart</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={
                                      busyAction !== null ||
                                      activeRun.status === "stopping"
                                    }
                                    onClick={() =>
                                      void handleStopProcess(activeRun.id)
                                    }
                                    title="Stop process tree"
                                    aria-label={`Stop ${name}`}
                                    className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] border border-danger/45 bg-danger-soft px-2 text-[11.5px] font-medium text-danger hover:bg-danger-solid hover:text-white disabled:opacity-45"
                                  >
                                    <Square
                                      className="h-2.5 w-2.5 fill-current"
                                      aria-hidden="true"
                                    />
                                    <span>Stop</span>
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={
                                    service.isMissing || busyAction !== null
                                  }
                                  onClick={() => void handleRunScript(name)}
                                  title={`Jalankan via ${effectivePm} run ${name}`}
                                  className="btn-press inline-flex h-7 items-center gap-1 rounded-[6px] bg-accent px-2.5 text-[11.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-45"
                                >
                                  <Play
                                    className="h-3 w-3 fill-current"
                                    aria-hidden="true"
                                  />
                                  <span>Run</span>
                                </button>
                              )}

                              {latestRun ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    openLogsForProcess(
                                      activeRun?.id ?? latestRun.id,
                                    )
                                  }
                                  title="Lihat log proses"
                                  aria-label={`Lihat log ${name}`}
                                  className="btn-press inline-flex h-7 items-center justify-center rounded-[6px] border border-border-strong bg-surface-2 px-2 text-fg-muted hover:bg-surface-hover hover:text-fg"
                                >
                                  <TerminalSquare
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}

          {/* Tab content: Env */}
          {tab === "env" ? <ServiceEnvTab service={service} /> : null}

          {/* Tab content: Storage */}
          {tab === "storage" ? (
            <ServiceStorageTab
              service={service}
              onReportChange={setStorageSummary}
            />
          ) : null}

          {/* Tab content: Settings */}
          {tab === "settings" ? (
            <div className="space-y-4">
              {/* Rename Service */}
              <form
                onSubmit={(e) => void handleRenameService(e)}
                className="rounded-[10px] border border-border bg-surface p-4"
              >
                <label
                  htmlFor="rename-service-input"
                  className="block text-[13px] font-semibold text-fg"
                >
                  Nama Service
                </label>
                <p className="mt-0.5 text-[12px] text-fg-muted">
                  Nama tampilan di sidebar & workbench (tidak mengubah package.json).
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    id="rename-service-input"
                    type="text"
                    value={serviceNameInput}
                    onChange={(e) => setServiceNameInput(e.target.value)}
                    className="h-8 flex-1 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[13px] text-fg"
                  />
                  <button
                    type="submit"
                    className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg hover:bg-surface-hover"
                  >
                    Simpan
                  </button>
                </div>
              </form>

              {/* Rename Project */}
              <form
                onSubmit={(e) => void handleRenameProject(e)}
                className="rounded-[10px] border border-border bg-surface p-4"
              >
                <label
                  htmlFor="rename-project-input"
                  className="block text-[13px] font-semibold text-fg"
                >
                  Nama Project Induk
                </label>
                <div className="mt-3 flex gap-2">
                  <input
                    id="rename-project-input"
                    type="text"
                    value={projectNameInput}
                    onChange={(e) => setProjectNameInput(e.target.value)}
                    className="h-8 flex-1 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[13px] text-fg"
                  />
                  <button
                    type="submit"
                    className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg hover:bg-surface-hover"
                  >
                    Simpan
                  </button>
                </div>
              </form>

              {/* Package Manager Override */}
              <div className="rounded-[10px] border border-border bg-surface p-4">
                <label
                  htmlFor="pm-override-select"
                  className="block text-[13px] font-semibold text-fg"
                >
                  Package Manager
                </label>
                <p className="mt-0.5 text-[12px] text-fg-muted">
                  Terdeteksi otomatis:{" "}
                  <span className="font-mono text-fg-2">{service.detectedPm}</span>.
                  Override jika deteksi tidak sesuai.
                </p>
                <select
                  id="pm-override-select"
                  value={service.pmOverride ?? "auto"}
                  onChange={(e) => {
                    const val = e.target.value;
                    void setPmOverride(
                      service.id,
                      val === "auto" ? null : (val as PackageManager),
                    );
                  }}
                  className="mt-3 h-8 w-56 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[13px] text-fg"
                >
                  <option value="auto">Auto ({service.detectedPm})</option>
                  <option value="npm">npm</option>
                  <option value="pnpm">pnpm</option>
                  <option value="yarn">yarn</option>
                  <option value="bun">bun</option>
                </select>
              </div>

              {/* Relocate folder */}
              <form
                onSubmit={(e) => void handleRelocateManual(e)}
                className="rounded-[10px] border border-border bg-surface p-4"
              >
                <label
                  htmlFor="relocate-path-input"
                  className="block text-[13px] font-semibold text-fg"
                >
                  Lokasi Folder di Disk
                </label>
                <div className="mt-3 flex gap-2">
                  <input
                    id="relocate-path-input"
                    type="text"
                    value={relocateInput}
                    onChange={(e) => setRelocateInput(e.target.value)}
                    className="h-8 min-w-0 flex-1 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 font-mono text-[12px] text-fg"
                  />
                  <button
                    type="button"
                    onClick={() => void handleRelocateWithPicker()}
                    className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                  >
                    <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Pilih…</span>
                  </button>
                  <button
                    type="submit"
                    className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg hover:bg-surface-hover"
                  >
                    Simpan
                  </button>
                </div>
              </form>

              {/* Danger zone */}
              <div className="rounded-[10px] border border-danger/35 bg-surface p-4">
                <h3 className="text-[13px] font-semibold text-danger">
                  Hapus dari DevDock
                </h3>
                <p className="mt-0.5 text-[12px] text-fg-muted">
                  Menghapus hanya mencabut pendaftaran di DevDock. Folder dan file kode di disk tidak akan dihapus.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveTarget("service")}
                    className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-danger/50 bg-danger-soft px-3 text-[12.5px] font-medium text-danger hover:bg-danger-solid hover:text-white"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Hapus Service</span>
                  </button>
                  {!isSingleServiceProject ? (
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveTarget("project")}
                      className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-danger-solid px-3 text-[12.5px] font-semibold text-white hover:opacity-95"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Hapus Seluruh Project ({project.name})</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Right Inspector (280px) */}
      <aside className="hidden w-[280px] shrink-0 overflow-y-auto border-l border-border bg-bg-sidebar p-4 xl:block">
        <h2 className="text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
          Runtime Summary
        </h2>
        <div className="mt-3 space-y-2.5 rounded-[10px] border border-border bg-surface p-3.5 text-[12.5px]">
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">Adapter</span>
            <span className="font-mono text-fg">{service.adapter}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">Framework</span>
            <span className="font-medium text-fg">
              {FRAMEWORK_LABELS[service.detectedFramework]}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">Package Manager</span>
            <span className="font-mono text-fg">{effectivePm}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">Default Script</span>
            <span className="font-mono text-fg">
              {service.defaultScript ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">Total Scripts</span>
            <span className="font-mono text-fg tabular-nums">
              {scriptEntries.length}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">Proses Aktif</span>
            <span
              className={cn(
                "font-mono tabular-nums",
                activeServiceProcesses.length > 0
                  ? "font-semibold text-accent"
                  : "text-fg-muted",
              )}
            >
              {activeServiceProcesses.length}
            </span>
          </div>
          {activeServiceProcesses.length > 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-fg-muted">PID</span>
              <span className="font-mono text-[11.5px] text-fg tabular-nums">
                {activeServiceProcesses
                  .map((p) => p.pid)
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">Status Folder</span>
            <span
              className={cn(
                "font-medium",
                service.isMissing ? "text-warn" : "text-accent",
              )}
            >
              {service.isMissing ? "Missing" : "Tersedia"}
            </span>
          </div>
        </div>

        <h2 className="mt-5 text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
          Storage Summary
        </h2>
        <div className="mt-3 space-y-2 rounded-[10px] border border-border bg-surface p-3.5 text-[12.5px]">
          {storageSummary ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Total</span>
                <span className="font-mono font-semibold text-fg tabular-nums">
                  {formatBytes(storageSummary.totalBytes)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">node_modules</span>
                <span className="font-mono text-warn tabular-nums">
                  {formatBytes(storageSummary.nodeModulesBytes)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Build & Cache</span>
                <span className="font-mono text-info tabular-nums">
                  {formatBytes(storageSummary.buildCacheBytes)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setTab("storage")}
                className="btn-press mt-2 w-full rounded-[6px] border border-border-strong bg-surface-2 py-1.5 text-center text-[11.5px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
              >
                Kelola Storage
              </button>
            </>
          ) : (
            <div className="skeleton-shimmer h-16 rounded-[6px]" />
          )}
        </div>
      </aside>

      <ConfirmDialog
        open={confirmRemoveTarget !== null}
        title={
          confirmRemoveTarget === "project"
            ? `Hapus project "${project.name}"?`
            : `Hapus service "${service.name}"?`
        }
        description="Tindakan ini hanya menghapus entri dari DevDock. Folder dan file kode asli Anda di disk tidak akan disentuh."
        confirmLabel="Hapus dari DevDock"
        onCancel={() => setConfirmRemoveTarget(null)}
        onConfirm={() => {
          const target = confirmRemoveTarget;
          setConfirmRemoveTarget(null);
          if (target === "project") {
            void removeProject(project.id);
          } else if (target === "service") {
            void removeService(service.id);
          }
        }}
      />
    </div>
  );
}
