import { create } from "zustand";
import {
  type AppBootstrapInfo,
  type PackageManager,
  type Project,
  attachFolderToProject,
  getBootstrapInfo,
  listProjects,
  refreshService as apiRefreshService,
  refreshShellPath,
  registerFolderAsProject,
  relocateService as apiRelocateService,
  removeProject as apiRemoveProject,
  removeService as apiRemoveService,
  renameProject as apiRenameProject,
  renameService as apiRenameService,
  setAppSetting,
  setServicePmOverride,
} from "@/lib/tauri";

export type ThemeMode = "dark" | "light";

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
  theme: ThemeMode;
  sidebarOpen: boolean;
  logDrawerOpen: boolean;
  route: ActiveRoute;
  toasts: ToastItem[];
  commandPaletteOpen: boolean;
  addProjectModalOpen: boolean;
  addProjectDefaultTargetId: string | null;

  init: () => Promise<void>;
  loadProjects: () => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  toggleTheme: () => Promise<void>;
  toggleSidebar: () => void;
  toggleLogDrawer: () => void;
  setRoute: (route: ActiveRoute) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  openAddProjectModal: (targetProjectId?: string | null) => void;
  closeAddProjectModal: () => void;
  refreshPath: () => Promise<void>;

  registerProject: (folder: string, projectName?: string) => Promise<Project>;
  attachService: (
    projectId: string,
    folder: string,
    serviceName?: string,
  ) => Promise<void>;
  refreshService: (serviceId: string) => Promise<void>;
  renameProject: (projectId: string, newName: string) => Promise<void>;
  renameService: (serviceId: string, newName: string) => Promise<void>;
  setPmOverride: (serviceId: string, pm: PackageManager | null) => Promise<void>;
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
  theme: "dark",
  sidebarOpen: true,
  logDrawerOpen: false,
  route: { kind: "overview" },
  toasts: [],
  commandPaletteOpen: false,
  addProjectModalOpen: false,
  addProjectDefaultTargetId: null,

  init: async () => {
    try {
      const [info, projects] = await Promise.all([
        getBootstrapInfo(),
        listProjects(),
      ]);
      const theme: ThemeMode = info.theme === "light" ? "light" : "dark";
      applyThemeClass(theme);
      set({ bootstrap: info, theme, projects });
    } catch (err) {
      get().pushToast({
        title: "Gagal memuat konfigurasi awal",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  },

  loadProjects: async () => {
    try {
      const projects = await listProjects();
      set({ projects });
    } catch (err) {
      get().pushToast({
        title: "Gagal memuat daftar project",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
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
  setRoute: (route) => set({ route }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  openAddProjectModal: (targetProjectId = null) =>
    set({ addProjectModalOpen: true, addProjectDefaultTargetId: targetProjectId }),
  closeAddProjectModal: () =>
    set({ addProjectModalOpen: false, addProjectDefaultTargetId: null }),

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
