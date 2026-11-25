import { create } from "zustand";
import {
  type AppBootstrapInfo,
  type DesktopToolSettings,
  type EnvPreset,
  type GitStatusInfo,
  type GlobalStorageSummary,
  type MetricsSnapshot,
  type PackageManager,
  type PortInjectionMethod,
  type PortInspectorSnapshot,
  type ProcessInfo,
  type Project,
  type ProjectOrchestrationStep,
  type ProxyStatus,
  analyzeAllStorage,
  assignNextFreePort as apiAssignNextFreePort,
  attachFolderToProject,
  cleanProjectBuildCaches as apiCleanProjectBuildCaches,
  getAllServicesGitInfo,
  getBootstrapInfo,
  getCachedGlobalStorage,
  getDesktopToolSettings,
  getMetricsSnapshot,
  getProxyStatus,
  inspectListeningPorts,
  listPresets,
  listProcesses,
  listProjects,
  refreshService as apiRefreshService,
  refreshShellPath,
  registerFolderAsProject,
  registerGroupedProject as apiRegisterGroupedProject,
  relocateService as apiRelocateService,
  removeProject as apiRemoveProject,
  removeService as apiRemoveService,
  renameProject as apiRenameProject,
  renameService as apiRenameService,
  reorderProjectServices as apiReorderProjectServices,
  restartProcess as apiRestartProcess,
  restartProjectAll as apiRestartProjectAll,
  runServiceScript as apiRunServiceScript,
  setAppSetting,
  setProxyEnabled as apiSetProxyEnabled,
  setScriptAutoRestart as apiSetScriptAutoRestart,
  setServiceDefaultScript as apiSetServiceDefaultScript,
  setServiceNodeVersionOverride,
  setServicePmOverride,
  setServicePort as apiSetServicePort,
  setServicePortInjection as apiSetServicePortInjection,
  startProjectAll as apiStartProjectAll,
  stopProcess as apiStopProcess,
  stopProjectAll as apiStopProjectAll,
} from "@/lib/tauri";

export type ThemeMode = "dark" | "light";

export type LogScope =
  | { kind: "project"; projectId: string }
  | { kind: "all" };

export type ActiveRoute =
  | { kind: "overview" }
  | { kind: "ports" }
  | { kind: "presets" }
  | { kind: "settings" }
  | { kind: "project"; projectId: string }
  | { kind: "service"; projectId: string; serviceId: string };

export type ToastVariant = "info" | "success" | "warn" | "danger";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface AppState {
  bootstrap: AppBootstrapInfo | null;
  projects: Project[];
  presets: EnvPreset[];
  processes: Record<string, ProcessInfo>;
  theme: ThemeMode;
  sidebarOpen: boolean;
  logDrawerOpen: boolean;
  logDrawerHeight: number;
  logDrawerMaximized: boolean;
  logScope: LogScope;
  activeLogTab: "combined" | string;
  hiddenLogTabIds: string[];
  route: ActiveRoute;
  toasts: ToastItem[];
  commandPaletteOpen: boolean;
  addProjectModalOpen: boolean;
  addProjectDefaultTargetId: string | null;
  scanModalOpen: boolean;
  globalStorage: GlobalStorageSummary | null;
  storageLoading: boolean;
  portSnapshot: PortInspectorSnapshot | null;
  portsLoading: boolean;
  metrics: MetricsSnapshot | null;
  proxyStatus: ProxyStatus | null;
  gitInfoByService: Record<string, GitStatusInfo>;
  toolSettings: DesktopToolSettings | null;
  orchestrationSteps: Record<string, Record<string, ProjectOrchestrationStep>>;
  orchestratingProjectIds: Record<string, boolean>;

  init: () => Promise<void>;
  loadProjects: () => Promise<void>;
  loadGitInfo: () => Promise<void>;
  loadToolSettings: () => Promise<void>;
  setToolSettings: (settings: DesktopToolSettings) => void;
  loadPresets: () => Promise<void>;
  loadProcesses: () => Promise<void>;
  refreshPorts: () => Promise<void>;
  setMetricsSnapshot: (snapshot: MetricsSnapshot) => void;
  setProxyStatus: (status: ProxyStatus) => void;
  setProxyEnabled: (enabled: boolean) => Promise<void>;
  upsertProcess: (info: ProcessInfo) => void;
  runScript: (serviceId: string, script: string) => Promise<ProcessInfo>;
  stopProcess: (processId: string) => Promise<void>;
  restartProcess: (processId: string) => Promise<void>;
  refreshGlobalStorage: (forceRefresh?: boolean) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  toggleTheme: () => Promise<void>;
  toggleSidebar: () => void;
  toggleLogDrawer: () => void;
  setLogDrawerOpen: (open: boolean) => void;
  setLogDrawerHeight: (height: number) => void;
  setLogDrawerMaximized: (maximized: boolean) => void;
  setLogScope: (scope: LogScope) => void;
  setActiveLogTab: (tab: "combined" | string) => void;
  hideLogTab: (processId: string) => void;
  restoreLogTab: (processId: string) => void;
  openLogsForProcess: (processId: string) => void;
  setRoute: (route: ActiveRoute) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  openAddProjectModal: (targetProjectId?: string | null) => void;
  closeAddProjectModal: () => void;
  openScanModal: () => void;
  closeScanModal: () => void;
  refreshPath: () => Promise<void>;

  registerProject: (folder: string, projectName?: string) => Promise<Project>;
  registerGroupedProject: (
    projectName: string,
    folders: string[],
    rootPath?: string | null,
  ) => Promise<Project>;
  attachService: (
    projectId: string,
    folder: string,
    serviceName?: string,
  ) => Promise<void>;
  refreshService: (serviceId: string) => Promise<void>;
  renameProject: (projectId: string, newName: string) => Promise<void>;
  renameService: (serviceId: string, newName: string) => Promise<void>;
  setPmOverride: (serviceId: string, pm: PackageManager | null) => Promise<void>;
  setNodeVersionOverride: (serviceId: string, version: string | null) => Promise<void>;
  setScriptAutoRestart: (
    serviceId: string,
    scriptName: string,
    enabled: boolean,
  ) => Promise<void>;
  setServicePort: (serviceId: string, port: number | null) => Promise<void>;
  setServicePortInjection: (
    serviceId: string,
    method: PortInjectionMethod | null,
  ) => Promise<void>;
  setServiceDefaultScript: (
    serviceId: string,
    defaultScript: string | null,
  ) => Promise<void>;
  reorderProjectServices: (
    projectId: string,
    serviceIds: string[],
  ) => Promise<void>;
  setOrchestrationStep: (step: ProjectOrchestrationStep) => void;
  startProjectAll: (projectId: string) => Promise<void>;
  stopProjectAll: (projectId: string) => Promise<void>;
  restartProjectAll: (projectId: string) => Promise<void>;
  cleanProjectBuildCaches: (projectId: string) => Promise<number>;
  assignNextFreePort: (serviceId: string) => Promise<number | null>;
  relocateService: (serviceId: string, newFolder: string) => Promise<void>;
  removeService: (serviceId: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;

  pushToast: (toast: Omit<ToastItem, "id">) => string;
  dismissToast: (id: string) => void;
}

function applyThemeClass(theme: ThemeMode) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.remove("dark");
    root.classList.add("light");
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  bootstrap: null,
  projects: [],
  presets: [],
  processes: {},
  theme: "dark",
  sidebarOpen: true,
  logDrawerOpen: false,
  logDrawerHeight: 240,
  logDrawerMaximized: false,
  logScope: { kind: "all" },
  activeLogTab: "combined",
  hiddenLogTabIds: [],
  route: { kind: "overview" },
  toasts: [],
  commandPaletteOpen: false,
  addProjectModalOpen: false,
  addProjectDefaultTargetId: null,
  scanModalOpen: false,
  globalStorage: null,
  storageLoading: false,
  portSnapshot: null,
  portsLoading: false,
  metrics: null,
  proxyStatus: null,
  gitInfoByService: {},
  toolSettings: null,
  orchestrationSteps: {},
  orchestratingProjectIds: {},

  init: async () => {
    try {
      const [
        info,
        projects,
        presets,
        cachedStorage,
        procList,
        ports,
        metrics,
        proxyStatus,
        gitInfoByService,
        toolSettings,
      ] = await Promise.all([
        getBootstrapInfo(),
        listProjects(),
        listPresets(),
        getCachedGlobalStorage(),
        listProcesses(),
        inspectListeningPorts(),
        getMetricsSnapshot(),
        getProxyStatus(),
        getAllServicesGitInfo(),
        getDesktopToolSettings(),
      ]);
      const theme: ThemeMode = info.theme === "light" ? "light" : "dark";
      applyThemeClass(theme);
      const processes: Record<string, ProcessInfo> = {};
      for (const p of procList) {
        processes[p.id] = p;
      }
      set({
        bootstrap: info,
        theme,
        projects,
        presets,
        processes,
        globalStorage: cachedStorage,
        portSnapshot: ports,
        metrics,
        proxyStatus,
        gitInfoByService,
        toolSettings,
      });
      // Gently warm storage cache in the background when services exist
      if (projects.some((p) => p.services.length > 0)) {
        void get().refreshGlobalStorage(false);
      }
    } catch (err) {
      get().pushToast({
        title: "Gagal memuat konfigurasi awal",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  },

  loadProcesses: async () => {
    try {
      const list = await listProcesses();
      const map: Record<string, ProcessInfo> = {};
      for (const p of list) {
        map[p.id] = p;
      }
      set({ processes: map });
    } catch {
      // Non-fatal
    }
  },

  refreshPorts: async () => {
    set({ portsLoading: true });
    try {
      const snapshot = await inspectListeningPorts();
      set({ portSnapshot: snapshot });
    } catch {
      // Non-fatal
    } finally {
      set({ portsLoading: false });
    }
  },

  setMetricsSnapshot: (snapshot) => {
    set({ metrics: snapshot });
  },

  setProxyStatus: (proxyStatus) => {
    set({ proxyStatus });
  },

  setProxyEnabled: async (enabled) => {
    const status = await apiSetProxyEnabled(enabled);
    set({ proxyStatus: status });
    get().pushToast({
      title: status.running
        ? `Reverse proxy *.localhost aktif di :${status.boundPort}`
        : "Reverse proxy *.localhost dimatikan",
      variant: status.running ? "success" : "info",
    });
  },

  upsertProcess: (info) => {
    set((s) => ({
      processes: { ...s.processes, [info.id]: info },
    }));
  },

  runScript: async (serviceId, script) => {
    const info = await apiRunServiceScript(serviceId, script);
    set((s) => ({
      processes: { ...s.processes, [info.id]: info },
      logDrawerOpen: true,
      logScope: { kind: "project", projectId: info.projectId },
      activeLogTab: info.id,
      hiddenLogTabIds: s.hiddenLogTabIds.filter((id) => id !== info.id),
    }));
    return info;
  },

  stopProcess: async (processId) => {
    const info = await apiStopProcess(processId);
    set((s) => ({
      processes: { ...s.processes, [info.id]: info },
    }));
  },

  restartProcess: async (processId) => {
    const info = await apiRestartProcess(processId);
    set((s) => ({
      processes: { ...s.processes, [info.id]: info },
      logDrawerOpen: true,
      logScope: { kind: "project", projectId: info.projectId },
      activeLogTab: info.id,
      hiddenLogTabIds: s.hiddenLogTabIds.filter((id) => id !== info.id),
    }));
  },

  loadPresets: async () => {
    try {
      const presets = await listPresets();
      set({ presets });
    } catch (err) {
      get().pushToast({
        title: "Gagal memuat Env Presets",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  },

  loadProjects: async () => {
    try {
      const projects = await listProjects();
      set({ projects });
      void get().refreshGlobalStorage(false);
      void get().loadGitInfo();
    } catch (err) {
      get().pushToast({
        title: "Gagal memuat daftar project",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  },

  loadGitInfo: async () => {
    try {
      const gitInfoByService = await getAllServicesGitInfo();
      set({ gitInfoByService });
    } catch {
      // Non-fatal
    }
  },

  loadToolSettings: async () => {
    try {
      const toolSettings = await getDesktopToolSettings();
      set({ toolSettings });
    } catch {
      // Non-fatal
    }
  },

  setToolSettings: (toolSettings) => {
    set({ toolSettings });
  },

  refreshGlobalStorage: async (forceRefresh = false) => {
    set({ storageLoading: true });
    try {
      const summary = await analyzeAllStorage(forceRefresh);
      set({ globalStorage: summary });
    } catch {
      // Non-fatal background refresh
    } finally {
      set({ storageLoading: false });
    }
  },

  setTheme: async (theme) => {
    applyThemeClass(theme);
    set({ theme });
    try {
      await setAppSetting("theme", theme);
    } catch {
      // Non-fatal
    }
  },

  toggleTheme: async () => {
    const next: ThemeMode = get().theme === "dark" ? "light" : "dark";
    await get().setTheme(next);
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleLogDrawer: () => set((s) => ({ logDrawerOpen: !s.logDrawerOpen })),
  setLogDrawerOpen: (open) => set({ logDrawerOpen: open }),
  setLogDrawerHeight: (height) => set({ logDrawerHeight: height }),
  setLogDrawerMaximized: (maximized) => set({ logDrawerMaximized: maximized }),
  setLogScope: (scope) =>
    set({
      logScope: scope,
      activeLogTab: "combined",
    }),
  setActiveLogTab: (tab) => set({ activeLogTab: tab }),
  hideLogTab: (processId) =>
    set((s) => ({
      hiddenLogTabIds: s.hiddenLogTabIds.includes(processId)
        ? s.hiddenLogTabIds
        : [...s.hiddenLogTabIds, processId],
      activeLogTab: s.activeLogTab === processId ? "combined" : s.activeLogTab,
    })),
  restoreLogTab: (processId) =>
    set((s) => ({
      hiddenLogTabIds: s.hiddenLogTabIds.filter((id) => id !== processId),
      activeLogTab: processId,
    })),
  openLogsForProcess: (processId) =>
    set((s) => {
      const proc = s.processes[processId];
      return {
        logDrawerOpen: true,
        logScope: proc
          ? { kind: "project", projectId: proc.projectId }
          : s.logScope,
        activeLogTab: processId,
        hiddenLogTabIds: s.hiddenLogTabIds.filter((id) => id !== processId),
      };
    }),
  setRoute: (route) =>
    set((s) => {
      if (route.kind === "project" || route.kind === "service") {
        const nextScope: LogScope = {
          kind: "project",
          projectId: route.projectId,
        };
        const currentProc =
          s.activeLogTab !== "combined" ? s.processes[s.activeLogTab] : undefined;
        const keepActiveTab =
          currentProc && currentProc.projectId === route.projectId;
        return {
          route,
          logScope: nextScope,
          activeLogTab: keepActiveTab ? s.activeLogTab : "combined",
        };
      }
      return { route };
    }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  openAddProjectModal: (targetProjectId = null) =>
    set({ addProjectModalOpen: true, addProjectDefaultTargetId: targetProjectId }),
  closeAddProjectModal: () =>
    set({ addProjectModalOpen: false, addProjectDefaultTargetId: null }),
  openScanModal: () => set({ scanModalOpen: true }),
  closeScanModal: () => set({ scanModalOpen: false }),

  refreshPath: async () => {
    try {
      const shellPath = await refreshShellPath();
      set((s) => ({
        bootstrap: s.bootstrap ? { ...s.bootstrap, shellPath } : s.bootstrap,
      }));
      get().pushToast({
        title: "Login shell PATH diperbarui",
        variant: "success",
      });
    } catch (err) {
      get().pushToast({
        title: "Gagal menyegarkan PATH",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  },

  registerProject: async (folder, projectName) => {
    const project = await registerFolderAsProject(folder, projectName);
    await get().loadProjects();
    if (project.services.length === 1) {
      set({
        route: {
          kind: "service",
          projectId: project.id,
          serviceId: project.services[0].id,
        },
      });
    } else {
      set({ route: { kind: "project", projectId: project.id } });
    }
    get().pushToast({
      title: `Project "${project.name}" ditambahkan`,
      variant: "success",
    });
    return project;
  },

  registerGroupedProject: async (projectName, folders, rootPath = null) => {
    const project = await apiRegisterGroupedProject(projectName, folders, rootPath);
    await get().loadProjects();
    set({ route: { kind: "project", projectId: project.id } });
    get().pushToast({
      title: `Project "${project.name}" (${project.services.length} service) ditambahkan`,
      variant: "success",
    });
    return project;
  },

  attachService: async (projectId, folder, serviceName) => {
    const service = await attachFolderToProject(projectId, folder, serviceName);
    await get().loadProjects();
    set({
      route: {
        kind: "service",
        projectId,
        serviceId: service.id,
      },
    });
    get().pushToast({
      title: `Service "${service.name}" ditambahkan ke project`,
      variant: "success",
    });
  },

  refreshService: async (serviceId) => {
    await apiRefreshService(serviceId);
    await get().loadProjects();
    get().pushToast({
      title: "package.json disegarkan",
      variant: "info",
    });
  },

  renameProject: async (projectId, newName) => {
    const updated = await apiRenameProject(projectId, newName);
    await get().loadProjects();
    get().pushToast({
      title: `Project diganti nama menjadi "${updated.name}"`,
      variant: "success",
    });
  },

  renameService: async (serviceId, newName) => {
    const updated = await apiRenameService(serviceId, newName);
    await get().loadProjects();
    get().pushToast({
      title: `Service diganti nama menjadi "${updated.name}"`,
      variant: "success",
    });
  },

  setPmOverride: async (serviceId, pm) => {
    await setServicePmOverride(serviceId, pm);
    await get().loadProjects();
    get().pushToast({
      title: pm
        ? `Package manager di-override ke ${pm}`
        : "Package manager dikembalikan ke deteksi otomatis",
      variant: "success",
    });
  },

  setNodeVersionOverride: async (serviceId, version) => {
    await setServiceNodeVersionOverride(serviceId, version);
    await get().loadProjects();
    get().pushToast({
      title: version?.trim()
        ? `Versi Node di-override ke ${version.trim()}`
        : "Versi Node dikembalikan ke deteksi otomatis",
      variant: "success",
    });
  },

  setScriptAutoRestart: async (serviceId, scriptName, enabled) => {
    await apiSetScriptAutoRestart(serviceId, scriptName, enabled);
    await get().loadProjects();
    get().pushToast({
      title: enabled
        ? `Auto-restart diaktifkan untuk "${scriptName}" (maks 3×/60d)`
        : `Auto-restart dimatikan untuk "${scriptName}"`,
      variant: "info",
    });
  },

  setServicePort: async (serviceId, port) => {
    await apiSetServicePort(serviceId, port);
    await get().loadProjects();
    void get().refreshPorts();
    get().pushToast({
      title: port
        ? `Port service diatur ke :${port}`
        : "Port service dikembalikan ke default",
      variant: "success",
    });
  },

  setServicePortInjection: async (serviceId, method) => {
    await apiSetServicePortInjection(serviceId, method);
    await get().loadProjects();
    get().pushToast({
      title: method
        ? `Metode inject port diatur ke ${method}`
        : "Metode inject port dikembalikan ke otomatis",
      variant: "success",
    });
  },

  setServiceDefaultScript: async (serviceId, defaultScript) => {
    await apiSetServiceDefaultScript(serviceId, defaultScript);
    await get().loadProjects();
    get().pushToast({
      title: defaultScript
        ? `Default script diatur ke "${defaultScript}"`
        : "Default script dikosongkan",
      variant: "success",
    });
  },

  reorderProjectServices: async (projectId, serviceIds) => {
    await apiReorderProjectServices(projectId, serviceIds);
    await get().loadProjects();
  },

  setOrchestrationStep: (step) => {
    set((s) => ({
      orchestrationSteps: {
        ...s.orchestrationSteps,
        [step.projectId]: {
          ...(s.orchestrationSteps[step.projectId] ?? {}),
          [step.serviceId]: step,
        },
      },
    }));
  },

  startProjectAll: async (projectId) => {
    set((s) => ({
      orchestratingProjectIds: { ...s.orchestratingProjectIds, [projectId]: true },
      logDrawerOpen: true,
      logScope: { kind: "project", projectId },
      activeLogTab: "combined",
    }));
    try {
      const res = await apiStartProjectAll(projectId);
      await Promise.all([get().loadProcesses(), get().refreshPorts()]);
      const failedCount = res.steps.filter((st) => st.state === "failed").length;
      get().pushToast({
        title:
          failedCount > 0
            ? `Start All selesai (${failedCount} gagal)`
            : `${res.status.runningServices}/${res.status.totalServices} service berjalan`,
        variant: failedCount > 0 ? "warn" : "success",
      });
    } catch (err) {
      get().pushToast({
        title: "Gagal menjalankan semua service",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      set((s) => ({
        orchestratingProjectIds: { ...s.orchestratingProjectIds, [projectId]: false },
      }));
    }
  },

  stopProjectAll: async (projectId) => {
    set((s) => ({
      orchestratingProjectIds: { ...s.orchestratingProjectIds, [projectId]: true },
    }));
    try {
      const res = await apiStopProjectAll(projectId);
      await Promise.all([get().loadProcesses(), get().refreshPorts()]);
      get().pushToast({
        title: `${res.stoppedProcessIds.length} proses dihentikan`,
        variant: "info",
      });
    } catch (err) {
      get().pushToast({
        title: "Gagal menghentikan semua service",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      set((s) => ({
        orchestratingProjectIds: { ...s.orchestratingProjectIds, [projectId]: false },
      }));
    }
  },

  restartProjectAll: async (projectId) => {
    set((s) => ({
      orchestratingProjectIds: { ...s.orchestratingProjectIds, [projectId]: true },
      logDrawerOpen: true,
      logScope: { kind: "project", projectId },
      activeLogTab: "combined",
    }));
    try {
      const res = await apiRestartProjectAll(projectId);
      await Promise.all([get().loadProcesses(), get().refreshPorts()]);
      get().pushToast({
        title: `Project di-restart (${res.status.runningServices}/${res.status.totalServices} berjalan)`,
        variant: "success",
      });
    } catch (err) {
      get().pushToast({
        title: "Gagal me-restart semua service",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      set((s) => ({
        orchestratingProjectIds: { ...s.orchestratingProjectIds, [projectId]: false },
      }));
    }
  },

  cleanProjectBuildCaches: async (projectId) => {
    const cleaned = await apiCleanProjectBuildCaches(projectId);
    const freed = cleaned.reduce((sum, item) => sum + item.freedBytes, 0);
    await get().refreshGlobalStorage(true);
    get().pushToast({
      title:
        cleaned.length > 0
          ? `${cleaned.length} folder build cache dibersihkan`
          : "Tidak ada build cache untuk dibersihkan",
      variant: cleaned.length > 0 ? "success" : "info",
    });
    return freed;
  },

  assignNextFreePort: async (serviceId) => {
    const updated = await apiAssignNextFreePort(serviceId);
    await get().loadProjects();
    void get().refreshPorts();
    if (updated.port) {
      get().pushToast({
        title: `Port kosong :${updated.port} ditetapkan untuk ${updated.name}`,
        variant: "success",
      });
    }
    return updated.port;
  },

  relocateService: async (serviceId, newFolder) => {
    const updated = await apiRelocateService(serviceId, newFolder);
    await get().loadProjects();
    get().pushToast({
      title: `Folder "${updated.name}" berhasil direlokasi`,
      variant: "success",
    });
  },

  removeService: async (serviceId) => {
    await apiRemoveService(serviceId);
    await get().loadProjects();
    set({ route: { kind: "overview" } });
    get().pushToast({
      title: "Service dihapus dari DevDock",
      description: "File asli di disk tidak disentuh.",
      variant: "info",
    });
  },

  removeProject: async (projectId) => {
    await apiRemoveProject(projectId);
    await get().loadProjects();
    set({ route: { kind: "overview" } });
    get().pushToast({
      title: "Project dihapus dari DevDock",
      description: "File asli di disk tidak disentuh.",
      variant: "info",
    });
  },

  pushToast: (toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({
      toasts: [...s.toasts.slice(-2), { ...toast, id }],
    }));
    return id;
  },

  dismissToast: (id) => {
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    }));
  },
}));
