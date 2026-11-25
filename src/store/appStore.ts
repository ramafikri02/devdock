import { create } from "zustand";
import {
  type AppBootstrapInfo,
  getBootstrapInfo,
  refreshShellPath,
  setAppSetting,
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
  theme: ThemeMode;
  sidebarOpen: boolean;
  logDrawerOpen: boolean;
  route: ActiveRoute;
  toasts: ToastItem[];
  commandPaletteOpen: boolean;

  init: () => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  toggleTheme: () => Promise<void>;
  toggleSidebar: () => void;
  toggleLogDrawer: () => void;
  setRoute: (route: ActiveRoute) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  refreshPath: () => Promise<void>;
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
  theme: "dark",
  sidebarOpen: true,
  logDrawerOpen: false,
  route: { kind: "overview" },
  toasts: [],
  commandPaletteOpen: false,

  init: async () => {
    try {
      const info = await getBootstrapInfo();
      const theme: ThemeMode = info.theme === "light" ? "light" : "dark";
      applyThemeClass(theme);
      set({ bootstrap: info, theme });
    } catch (err) {
      get().pushToast({
        title: "Gagal memuat konfigurasi awal",
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
      // Ignore persistence errors in non-fatal theme toggle
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
