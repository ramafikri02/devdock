import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Code2,
  Cpu,
  Download,
  FileCode2,
  FolderOpen,
  GitBranch,
  Globe,
  HardDrive,
  Layers,
  Loader2,
  Network,
  Package,
  Play,
  RefreshCw,
  RotateCw,
  Settings,
  Skull,
  Square,
  Terminal,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import {
  FRAMEWORK_LABELS,
  type NodeVersionSource,
  type PackageManager,
  type PortCheckResult,
  type PortInjectionMethod,
  type ProcessInfo,
  type Project,
  type Service,
  type ServiceNodeRuntime,
  type ServiceStorageReport,
  analyzeServiceStorage,
  checkServicePort,
  inspectServiceNodeRuntime,
  installNodeVersion,
  killPortOwner,
  onNodeInstallProgress,
  openExternalUrl,
  openServiceQuickAction,
  pickFolderDialog,
} from "@/lib/tauri";
import { formatBytes, formatDuration } from "@/lib/format";
import { useAppStore } from "@/store/appStore";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MetricChartCard } from "@/components/ui/MetricChart";
import { ServiceEnvTab } from "@/components/workbench/ServiceEnvTab";
import { ServiceStorageTab } from "@/components/workbench/ServiceStorageTab";
import { cn } from "@/lib/cn";

interface ServiceWorkbenchViewProps {
  project: Project;
  service: Service;
}

type WorkbenchTab = "scripts" | "env" | "storage" | "settings";

const NODE_SOURCE_LABELS: Record<NodeVersionSource, string> = {
  nvmrc: ".nvmrc",
  node_version_file: ".node-version",
  engines_node: "engines.node",
  manual_override: "override",
  none: "system",
};

export function ServiceWorkbenchView({
  project,
  service,
}: ServiceWorkbenchViewProps) {
  const refreshService = useAppStore((s) => s.refreshService);
  const renameService = useAppStore((s) => s.renameService);
  const renameProject = useAppStore((s) => s.renameProject);
  const setPmOverride = useAppStore((s) => s.setPmOverride);
  const setNodeVersionOverride = useAppStore((s) => s.setNodeVersionOverride);
  const setScriptAutoRestart = useAppStore((s) => s.setScriptAutoRestart);
  const setServicePort = useAppStore((s) => s.setServicePort);
  const setServicePortInjection = useAppStore((s) => s.setServicePortInjection);
  const assignNextFreePort = useAppStore((s) => s.assignNextFreePort);
  const refreshPorts = useAppStore((s) => s.refreshPorts);
  const relocateService = useAppStore((s) => s.relocateService);
  const removeService = useAppStore((s) => s.removeService);
  const removeProject = useAppStore((s) => s.removeProject);
  const setRoute = useAppStore((s) => s.setRoute);
  const pushToast = useAppStore((s) => s.pushToast);
  const processes = useAppStore((s) => s.processes);
  const metrics = useAppStore((s) => s.metrics);
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const gitInfo = useAppStore((s) => s.gitInfoByService[service.id]);
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
  const [nodeRuntime, setNodeRuntime] = useState<ServiceNodeRuntime | null>(null);
  const [nodeOverrideInput, setNodeOverrideInput] = useState(
    service.nodeVersionOverride ?? "",
  );
  const [installingNode, setInstallingNode] = useState(false);
  const [installProgressLine, setInstallProgressLine] = useState<string | null>(null);
  const [portInput, setPortInput] = useState(
    service.port !== null ? String(service.port) : "",
  );
  const [portConflict, setPortConflict] = useState<{
    scriptName: string;
    check: PortCheckResult;
  } | null>(null);
  const [confirmKillConflictPid, setConfirmKillConflictPid] = useState<number | null>(
    null,
  );
  const [chartsPaused, setChartsPaused] = useState(false);
  const [frozenMetrics, setFrozenMetrics] = useState<
    { cpu: number[]; ram: number[]; currentCpu: number; currentRam: number } | null
  >(null);

  const liveServiceMetrics = metrics?.byService[service.id];
  const chartData = useMemo(() => {
    if (chartsPaused && frozenMetrics) {
      return frozenMetrics;
    }
    const history = liveServiceMetrics?.history ?? [];
    return {
      cpu: history.map((p) => p.cpuPercent),
      ram: history.map((p) => p.memoryBytes),
      currentCpu: liveServiceMetrics?.currentCpuPercent ?? 0,
      currentRam: liveServiceMetrics?.currentMemoryBytes ?? 0,
    };
  }, [chartsPaused, frozenMetrics, liveServiceMetrics]);

  const handleToggleChartsPause = () => {
    if (!chartsPaused) {
      setFrozenMetrics(chartData);
      setChartsPaused(true);
    } else {
      setChartsPaused(false);
      setFrozenMetrics(null);
    }
  };

  useEffect(() => {
    setServiceNameInput(service.name);
    setProjectNameInput(project.name);
    setRelocateInput(service.path);
    setNodeOverrideInput(service.nodeVersionOverride ?? "");
    setPortInput(service.port !== null ? String(service.port) : "");
    setPortConflict(null);
  }, [
    service.id,
    service.name,
    service.path,
    service.nodeVersionOverride,
    service.port,
    project.name,
  ]);

  useEffect(() => {
    let cancelled = false;
    void inspectServiceNodeRuntime(service.id)
      .then((rt) => {
        if (!cancelled) setNodeRuntime(rt);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [service.id, service.path, service.nodeVersionOverride, service.updatedAt]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onNodeInstallProgress((prog) => {
      setInstallProgressLine(prog.line);
      if (prog.done) {
        setInstallingNode(false);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

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
  const serviceProxyRoute = useMemo(
    () => proxyStatus?.routes.find((r) => r.serviceId === service.id) ?? null,
    [proxyStatus, service.id],
  );

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
          p.status === "restarting" ||
          p.status === "stopping",
      ),
    [serviceProcesses],
  );

  const latestCrashedProcess = useMemo(
    () =>
      activeServiceProcesses.length === 0
        ? (serviceProcesses.find((p) => p.status === "crashed") ?? null)
        : null,
    [serviceProcesses, activeServiceProcesses.length],
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

  const handleRunScript = async (scriptName: string, skipPortCheck = false) => {
    setBusyAction(`run:${scriptName}`);
    try {
      if (!skipPortCheck && service.port !== null) {
        const check = await checkServicePort(service.id);
        const ownedBySelf = check.owner?.devdockServiceId === service.id;
        if (!check.isAvailable && !ownedBySelf) {
          setPortConflict({ scriptName, check });
          return;
        }
      }
      setPortConflict(null);
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

  const handleResolveConflictUseNextPort = async () => {
    if (!portConflict?.check.suggestedPort) return;
    const { scriptName, check } = portConflict;
    const nextPort = check.suggestedPort!;
    setBusyAction(`resolve:${scriptName}`);
    try {
      await setServicePort(service.id, nextPort);
      setPortConflict(null);
      await runScript(service.id, scriptName);
    } catch (err) {
      pushToast({
        title: "Gagal mengganti port dan menjalankan script",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleResolveConflictKillPid = async (pid: number) => {
    const scriptName = portConflict?.scriptName;
    setConfirmKillConflictPid(null);
    setBusyAction(`kill:${pid}`);
    try {
      await killPortOwner(pid);
      await refreshPorts();
      pushToast({
        title: `Proses PID ${pid} berhasil dihentikan`,
        variant: "success",
      });
      setPortConflict(null);
      if (scriptName) {
        await runScript(service.id, scriptName);
      }
    } catch (err) {
      pushToast({
        title: `Gagal menghentikan PID ${pid}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSavePort = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = portInput.trim();
    if (!trimmed) {
      await setServicePort(service.id, null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      pushToast({
        title: "Port tidak valid",
        description: "Masukkan angka port antara 1024 hingga 65535.",
        variant: "warn",
      });
      return;
    }
    await setServicePort(service.id, parsed);
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
        : activeServiceProcesses.some((p) => p.status === "restarting")
          ? "restarting"
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

  const handleSaveNodeOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setNodeVersionOverride(
        service.id,
        nodeOverrideInput.trim() || null,
      );
      const updated = await inspectServiceNodeRuntime(service.id);
      setNodeRuntime(updated);
    } catch (err) {
      pushToast({
        title: "Gagal menyimpan override versi Node",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const handleInstallNode = async (version: string) => {
    setInstallingNode(true);
    setInstallProgressLine(`Memasang Node ${version} via fnm…`);
    try {
      const res = await installNodeVersion(version);
      pushToast({
        title: `Node ${res.version} berhasil dipasang via ${res.manager}`,
        variant: "success",
      });
      const updated = await inspectServiceNodeRuntime(service.id);
      setNodeRuntime(updated);
    } catch (err) {
      pushToast({
        title: `Gagal memasang Node ${version}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setInstallingNode(false);
    }
  };

  return (
    <div className="animate-view-enter flex h-full min-h-0">
      {/* Main left column */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="w-full space-y-5">
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
                ) : latestServiceStatus === "restarting" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2 py-0.5 text-[11.5px] font-medium text-warn">
                    <span
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn"
                      aria-hidden="true"
                    />
                    Restarting…
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
                {nodeRuntime &&
                (nodeRuntime.requiredVersion || nodeRuntime.activeNodeVersion) ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 font-mono text-[11.5px] tabular-nums",
                      nodeRuntime.status === "missing_in_manager" ||
                        nodeRuntime.status === "mismatch_no_manager"
                        ? "bg-warn-soft text-warn"
                        : "bg-surface-2 text-fg-2",
                    )}
                    title={nodeRuntime.warning ?? undefined}
                  >
                    <Cpu className="h-3 w-3" aria-hidden="true" />
                    <span>
                      Node{" "}
                      {nodeRuntime.matchedInstalledVersion ??
                        nodeRuntime.requiredVersion ??
                        nodeRuntime.activeNodeVersion}
                    </span>
                    <span className="text-[10.5px] opacity-80">
                      ({NODE_SOURCE_LABELS[nodeRuntime.source]})
                    </span>
                  </span>
                ) : null}
                {service.port !== null ? (
                  <span className="inline-flex items-center gap-1 rounded-[6px] bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-info tabular-nums">
                    <Network className="h-3 w-3" aria-hidden="true" />
                    :{service.port}
                  </span>
                ) : null}
                {proxyStatus?.running &&
                serviceProxyRoute &&
                activeServiceProcesses.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => void openExternalUrl(serviceProxyRoute.url)}
                    title={`Buka ${serviceProxyRoute.url}`}
                    className="btn-press inline-flex items-center gap-1 rounded-[6px] border border-info/35 bg-info-soft px-2 py-0.5 font-mono text-[11.5px] font-medium text-info hover:opacity-90"
                  >
                    <Globe className="h-3 w-3" aria-hidden="true" />
                    <span>{serviceProxyRoute.domain}</span>
                  </button>
                ) : null}
                {gitInfo?.isGitRepo && gitInfo.branch ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 font-mono text-[11.5px]",
                      gitInfo.isDirty
                        ? "bg-warn-soft text-warn"
                        : "bg-surface-2 text-fg-2",
                    )}
                    title={
                      gitInfo.isDirty
                        ? `${gitInfo.changedFiles} file berubah`
                        : "Working tree bersih"
                    }
                  >
                    <GitBranch className="h-3 w-3" aria-hidden="true" />
                    <span>{gitInfo.branch}</span>
                    {gitInfo.isDirty ? (
                      <span className="font-semibold" aria-label="dirty">
                        *
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <span className="truncate font-mono text-[11.5px] text-fg-faint select-text">
                  {service.path}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!service.isMissing ? (
                <div className="flex items-center gap-1 rounded-[7px] border border-border bg-surface p-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      void openServiceQuickAction(service.id, "editor").catch((e) =>
                        pushToast({
                          title: "Gagal membuka Editor",
                          description: e instanceof Error ? e.message : String(e),
                          variant: "danger",
                        }),
                      )
                    }
                    aria-label="Open in Editor"
                    title="Open in Editor"
                    className="btn-press flex h-7 w-7 items-center justify-center rounded-[5px] text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void openServiceQuickAction(service.id, "terminal").catch((e) =>
                        pushToast({
                          title: "Gagal membuka Terminal",
                          description: e instanceof Error ? e.message : String(e),
                          variant: "danger",
                        }),
                      )
                    }
                    aria-label="Open in Terminal"
                    title="Open in Terminal"
                    className="btn-press flex h-7 w-7 items-center justify-center rounded-[5px] text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void openServiceQuickAction(service.id, "browser").catch((e) =>
                        pushToast({
                          title: "Gagal membuka Browser",
                          description: e instanceof Error ? e.message : String(e),
                          variant: "danger",
                        }),
                      )
                    }
                    aria-label="Open in Browser"
                    title="Open in Browser"
                    className="btn-press flex h-7 w-7 items-center justify-center rounded-[5px] text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void openServiceQuickAction(service.id, "file_manager").catch(
                        (e) =>
                          pushToast({
                            title: "Gagal membuka Finder/Explorer",
                            description: e instanceof Error ? e.message : String(e),
                            variant: "danger",
                          }),
                      )
                    }
                    aria-label="Open in Finder / Explorer"
                    title="Open in Finder / Explorer"
                    className="btn-press flex h-7 w-7 items-center justify-center rounded-[5px] text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
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

          {/* Node runtime warning / one-click fnm install banner */}
          {!service.isMissing && nodeRuntime?.warning ? (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-warn/40 bg-warn-soft p-3.5"
            >
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-warn"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-fg">
                    {nodeRuntime.status === "missing_in_manager"
                      ? `Node ${nodeRuntime.requiredVersion} belum terpasang di ${nodeRuntime.versionManager ?? "fnm"}`
                      : "Versi Node aktif tidak cocok"}
                  </p>
                  <p className="mt-0.5 text-[12px] text-fg-muted">
                    {nodeRuntime.warning}
                  </p>
                  {installingNode && installProgressLine ? (
                    <p className="mt-1 truncate font-mono text-[11px] text-info">
                      {installProgressLine}
                    </p>
                  ) : null}
                </div>
              </div>
              {nodeRuntime.canInstall && nodeRuntime.installTarget ? (
                <button
                  type="button"
                  disabled={installingNode}
                  onClick={() => void handleInstallNode(nodeRuntime.installTarget!)}
                  className="btn-press flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12.5px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-55"
                >
                  {installingNode ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>
                    {installingNode
                      ? "Memasang…"
                      : `Install Node ${nodeRuntime.installTarget} via ${nodeRuntime.versionManager ?? "fnm"}`}
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Inline port conflict resolution card */}
          {portConflict ? (
            <div
              role="alert"
              className="rounded-[10px] border border-warn/50 bg-warn-soft p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-warn"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-[13px] font-semibold text-fg">
                      Bentrok Port :{portConflict.check.port} sebelum menjalankan{" "}
                      <span className="font-mono">{portConflict.scriptName}</span>
                    </p>
                    <p className="mt-0.5 text-[12px] text-fg-muted">
                      {portConflict.check.owner ? (
                        <>
                          Sedang dipakai oleh{" "}
                          <span className="font-mono font-medium text-fg">
                            {portConflict.check.owner.processName}
                          </span>{" "}
                          (PID{" "}
                          <span className="font-mono tabular-nums text-fg">
                            {portConflict.check.owner.pid}
                          </span>
                          ).
                        </>
                      ) : (
                        "Port sedang dipakai oleh proses lain di mesin lokal."
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {portConflict.check.suggestedPort ? (
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => void handleResolveConflictUseNextPort()}
                      className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-50"
                    >
                      <Network className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Pakai :{portConflict.check.suggestedPort}</span>
                    </button>
                  ) : null}
                  {portConflict.check.owner ? (
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        setConfirmKillConflictPid(portConflict.check.owner!.pid)
                      }
                      className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-danger-solid px-3 text-[12px] font-semibold text-white hover:opacity-95 disabled:opacity-50"
                    >
                      <Skull className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Kill PID {portConflict.check.owner.pid}</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setPortConflict(null)}
                    className="btn-press flex h-8 items-center rounded-[7px] border border-border-strong bg-surface px-3 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                  >
                    Batal
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Crash summary banner with Run again action */}
          {!service.isMissing && latestCrashedProcess ? (
            <div
              role="alert"
              className="rounded-[10px] border border-danger/45 bg-danger-soft p-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-danger"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-fg">
                      Script{" "}
                      <span className="font-mono">
                        {latestCrashedProcess.script}
                      </span>{" "}
                      crashed (exit {latestCrashedProcess.exitCode ?? "—"})
                      {latestCrashedProcess.restartCount > 0 ? (
                        <span className="ml-1.5 font-mono text-[11.5px] font-normal text-danger tabular-nums">
                          · {latestCrashedProcess.restartCount}× auto-restart
                        </span>
                      ) : null}
                    </p>
                    {latestCrashedProcess.crashReason ? (
                      <p className="mt-0.5 text-[12px] text-fg-2">
                        {latestCrashedProcess.crashReason}
                      </p>
                    ) : null}
                    {latestCrashedProcess.lastErrorSnippet ? (
                      <p className="mt-1 truncate rounded bg-surface/70 px-2 py-1 font-mono text-[11.5px] text-danger">
                        {latestCrashedProcess.lastErrorSnippet}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() =>
                      void handleRunScript(latestCrashedProcess.script)
                    }
                    className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-50"
                  >
                    <Play className="h-3 w-3 fill-current" aria-hidden="true" />
                    <span>Jalankan lagi</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openLogsForProcess(latestCrashedProcess.id)}
                    className="btn-press flex h-8 items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface px-2.5 text-[12px] font-medium text-fg-2 hover:bg-surface-hover hover:text-fg"
                  >
                    <TerminalSquare className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Log</span>
                  </button>
                </div>
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
                      <th className="px-4 py-2.5">Auto-Restart</th>
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
                          p.status === "restarting" ||
                          p.status === "stopping",
                      );
                      const activeRun = activeRuns[0] ?? null;
                      const latestRun = runs[0] ?? null;
                      const autoRestartOn = service.autoRestartScripts.includes(name);

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
                                      activeRun.status === "stopping" ||
                                        activeRun.status === "restarting"
                                        ? "bg-warn-soft text-warn"
                                        : "bg-accent-soft text-accent",
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "h-1.5 w-1.5 rounded-full",
                                        activeRun.status === "stopping" ||
                                          activeRun.status === "restarting"
                                          ? "animate-pulse bg-warn"
                                          : "bg-accent",
                                      )}
                                      aria-hidden="true"
                                    />
                                    {activeRun.status === "stopping"
                                      ? "Stopping…"
                                      : activeRun.status === "restarting"
                                        ? `Restarting (${activeRun.restartCount}/3)…`
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
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={autoRestartOn}
                              aria-label={`Auto-restart untuk ${name}`}
                              onClick={() =>
                                void setScriptAutoRestart(
                                  service.id,
                                  name,
                                  !autoRestartOn,
                                )
                              }
                              className={cn(
                                "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium transition-colors",
                                autoRestartOn
                                  ? "border-accent/50 bg-accent-soft text-accent"
                                  : "border-border-strong bg-surface-2 text-fg-muted hover:text-fg",
                              )}
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  autoRestartOn ? "bg-accent" : "bg-fg-faint",
                                )}
                                aria-hidden="true"
                              />
                              <span>{autoRestartOn ? "On" : "Off"}</span>
                            </button>
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

              {/* Node Version Override */}
              <form
                onSubmit={(e) => void handleSaveNodeOverride(e)}
                className="rounded-[10px] border border-border bg-surface p-4"
              >
                <label
                  htmlFor="node-version-override-input"
                  className="block text-[13px] font-semibold text-fg"
                >
                  Versi Node.js
                </label>
                <p className="mt-0.5 text-[12px] text-fg-muted">
                  Prioritas deteksi:{" "}
                  <span className="font-mono text-fg-2">.nvmrc</span> →{" "}
                  <span className="font-mono text-fg-2">.node-version</span> →{" "}
                  <span className="font-mono text-fg-2">engines.node</span>.
                  {nodeRuntime?.detectedVersion ? (
                    <>
                      {" "}
                      Terdeteksi:{" "}
                      <span className="font-mono text-fg-2">
                        {nodeRuntime.detectedVersion} (
                        {NODE_SOURCE_LABELS[nodeRuntime.detectedSource]})
                      </span>
                      .
                    </>
                  ) : (
                    " Tidak ada file versi Node di folder ini."
                  )}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    id="node-version-override-input"
                    type="text"
                    value={nodeOverrideInput}
                    onChange={(e) => setNodeOverrideInput(e.target.value)}
                    placeholder="Auto (kosongkan) atau mis. 20.11.1 / 22"
                    className="h-8 w-64 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 font-mono text-[12.5px] text-fg"
                  />
                  {nodeRuntime && nodeRuntime.installedVersions.length > 0 ? (
                    <select
                      aria-label="Pilih versi Node terpasang di fnm"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          setNodeOverrideInput(e.target.value);
                        }
                      }}
                      className="h-8 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 font-mono text-[12px] text-fg-2"
                    >
                      <option value="">Terpasang di fnm…</option>
                      {nodeRuntime.installedVersions.map((ver) => (
                        <option key={ver} value={ver}>
                          {ver}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button
                    type="submit"
                    className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg hover:bg-surface-hover"
                  >
                    Simpan
                  </button>
                  {service.nodeVersionOverride ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNodeOverrideInput("");
                        void setNodeVersionOverride(service.id, null);
                      }}
                      className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface px-2.5 text-[12px] text-fg-muted hover:bg-surface-hover hover:text-fg"
                    >
                      Reset ke Auto
                    </button>
                  ) : null}
                </div>
                {nodeRuntime?.canInstall && nodeRuntime.installTarget ? (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={installingNode}
                      onClick={() => void handleInstallNode(nodeRuntime.installTarget!)}
                      className="btn-press inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[12px] font-semibold text-accent-fg hover:opacity-95 disabled:opacity-55"
                    >
                      {installingNode ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>
                        Install Node {nodeRuntime.installTarget} via{" "}
                        {nodeRuntime.versionManager ?? "fnm"}
                      </span>
                    </button>
                    {installingNode && installProgressLine ? (
                      <span className="truncate font-mono text-[11.5px] text-info">
                        {installProgressLine}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </form>

              {/* Port & Injection Method */}
              <form
                onSubmit={(e) => void handleSavePort(e)}
                className="rounded-[10px] border border-border bg-surface p-4"
              >
                <label
                  htmlFor="service-port-input"
                  className="block text-[13px] font-semibold text-fg"
                >
                  Port & Metode Injeksi
                </label>
                <p className="mt-0.5 text-[12px] text-fg-muted">
                  Port persisten disuntikkan otomatis sesuai framework ({FRAMEWORK_LABELS[service.detectedFramework]}).
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    id="service-port-input"
                    type="number"
                    min={1024}
                    max={65535}
                    value={portInput}
                    onChange={(e) => setPortInput(e.target.value)}
                    placeholder="Auto (default framework)"
                    className="h-8 w-44 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 font-mono text-[12.5px] text-fg tabular-nums"
                  />
                  <select
                    aria-label="Metode injeksi port"
                    value={service.portInjection ?? "auto"}
                    onChange={(e) => {
                      const val = e.target.value;
                      void setServicePortInjection(
                        service.id,
                        val === "auto" ? null : (val as PortInjectionMethod),
                      );
                    }}
                    className="h-8 rounded-[7px] border border-border-strong bg-surface-2 px-2.5 text-[12.5px] text-fg"
                  >
                    <option value="auto">Injeksi: Auto (Framework)</option>
                    <option value="env">PORT env var saja</option>
                    <option value="flag">--port CLI flag saja</option>
                    <option value="both">PORT env + --port flag</option>
                  </select>
                  <button
                    type="submit"
                    className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg hover:bg-surface-hover"
                  >
                    Simpan
                  </button>
                  <button
                    type="button"
                    onClick={() => void assignNextFreePort(service.id)}
                    className="btn-press h-8 rounded-[7px] border border-border-strong bg-surface px-2.5 text-[12px] text-fg-2 hover:bg-surface-hover hover:text-fg"
                  >
                    Cari Port Kosong
                  </button>
                </div>
              </form>

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
          Live Monitoring
        </h2>
        <div className="mt-3 space-y-2.5">
          <MetricChartCard
            title="CPU Pohon Proses"
            currentText={`${chartData.currentCpu.toFixed(1)}%`}
            peakText={`${Math.max(0, ...chartData.cpu).toFixed(1)}%`}
            statusText={activeServiceProcesses.length > 0 ? "Aktif · 2s" : "Idle"}
            values={chartData.cpu}
            strokeColorVar="var(--info)"
            paused={chartsPaused}
            onTogglePause={handleToggleChartsPause}
          />
          <MetricChartCard
            title="RAM Pohon Proses"
            currentText={
              chartData.currentRam > 0 ? formatBytes(chartData.currentRam) : "0 MB"
            }
            peakText={
              Math.max(0, ...chartData.ram) > 0
                ? formatBytes(Math.max(0, ...chartData.ram))
                : "0 MB"
            }
            statusText={activeServiceProcesses.length > 0 ? "Aktif · 2s" : "Idle"}
            values={chartData.ram}
            strokeColorVar="var(--accent)"
            paused={chartsPaused}
            onTogglePause={handleToggleChartsPause}
          />
        </div>

        <h2 className="mt-5 text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
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
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg-muted">Node Version</span>
            <span
              className={cn(
                "truncate font-mono text-[12px] tabular-nums",
                nodeRuntime?.status === "missing_in_manager" ||
                  nodeRuntime?.status === "mismatch_no_manager"
                  ? "text-warn"
                  : "text-fg",
              )}
              title={nodeRuntime?.warning ?? undefined}
            >
              {nodeRuntime
                ? (nodeRuntime.matchedInstalledVersion ??
                    nodeRuntime.requiredVersion ??
                    nodeRuntime.activeNodeVersion ??
                    "—") +
                  (nodeRuntime.source !== "none"
                    ? ` (${NODE_SOURCE_LABELS[nodeRuntime.source]})`
                    : "")
                : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">Version Manager</span>
            <span className="font-mono text-fg">
              {nodeRuntime?.versionManager ?? "system"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">Default Script</span>
            <span className="font-mono text-fg">
              {service.defaultScript ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">Port</span>
            <span className="font-mono text-fg tabular-nums">
              {service.port !== null ? `:${service.port}` : "auto"}
              {service.portInjection ? ` (${service.portInjection})` : ""}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">Auto-Restart</span>
            <span className="font-mono text-fg tabular-nums">
              {service.autoRestartScripts.length > 0
                ? `${service.autoRestartScripts.length} script (3×/60d)`
                : "Off"}
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
      <ConfirmDialog
        open={confirmKillConflictPid !== null}
        title={
          confirmKillConflictPid !== null
            ? `Kill proses PID ${confirmKillConflictPid}?`
            : ""
        }
        description="Proses pemilik port akan dihentikan (SIGTERM lalu SIGKILL) agar port dapat langsung digunakan oleh service ini."
        confirmLabel="Kill & Jalankan"
        onCancel={() => setConfirmKillConflictPid(null)}
        onConfirm={() => {
          if (confirmKillConflictPid !== null) {
            void handleResolveConflictKillPid(confirmKillConflictPid);
          }
        }}
      />
    </div>
  );
}
