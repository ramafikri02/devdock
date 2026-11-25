import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type Framework =
  | "next-js"
  | "vite"
  | "nuxt"
  | "astro"
  | "svelte-kit"
  | "remix"
  | "nest-js"
  | "express"
  | "fastify"
  | "hono"
  | "unknown";

export const FRAMEWORK_LABELS: Record<Framework, string> = {
  "next-js": "Next.js",
  vite: "Vite",
  nuxt: "Nuxt",
  astro: "Astro",
  "svelte-kit": "SvelteKit",
  remix: "Remix",
  "nest-js": "NestJS",
  express: "Express",
  fastify: "Fastify",
  hono: "Hono",
  unknown: "Node.js",
};

export interface Service {
  id: string;
  projectId: string;
  name: string;
  path: string;
  adapter: string;
  startOrder: number;
  defaultScript: string | null;
  pmOverride: PackageManager | null;
  port: number | null;
  portInjection: "env" | "flag" | "both" | null;
  nodeVersionOverride: string | null;
  detectedPm: PackageManager;
  detectedFramework: Framework;
  scripts: Record<string, string>;
  isMissing: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  rootPath: string | null;
  createdAt: string;
  updatedAt: string;
  services: Service[];
}

export interface AppBootstrapInfo {
  version: string;
  schemaVersion: number;
  dbPath: string;
  shellPath: string;
  theme: "dark" | "light" | string;
  adapters: string[];
}

export type ScanCandidateKind = "service" | "monorepo";

export interface ScanWorkspacePackage {
  name: string;
  path: string;
  packageManager: PackageManager;
  framework: Framework;
  scriptCount: number;
  alreadyRegistered: boolean;
}

export interface ScanCandidate {
  kind: ScanCandidateKind;
  name: string;
  path: string;
  adapter: string;
  packageManager: PackageManager;
  framework: Framework;
  scriptCount: number;
  alreadyRegistered: boolean;
  workspacePackages: ScanWorkspacePackage[];
}

export interface ScanResult {
  rootPath: string;
  maxDepth: number;
  scannedDirs: number;
  candidates: ScanCandidate[];
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getBootstrapInfo(): Promise<AppBootstrapInfo> {
  if (!isTauriRuntime()) {
    return {
      version: "0.1.0",
      schemaVersion: 1,
      dbPath: "browser-preview://in-memory",
      shellPath: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
      theme: (localStorage.getItem("devdock.theme") as "dark" | "light") || "dark",
      adapters: ["node"],
    };
  }
  return invoke<AppBootstrapInfo>("get_bootstrap_info");
}

export async function refreshShellPath(): Promise<string> {
  if (!isTauriRuntime()) {
    return "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
  }
  return invoke<string>("refresh_shell_path");
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem(`devdock.${key}`, value);
    return;
  }
  await invoke("set_setting", { key, value });
}

export async function pickFolderDialog(title = "Pilih folder project Node.js"): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });
  return typeof selected === "string" ? selected : null;
}

export async function listProjects(): Promise<Project[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<Project[]>("list_projects");
}

export async function registerFolderAsProject(
  folder: string,
  projectName?: string,
): Promise<Project> {
  return invoke<Project>("register_folder_as_project", {
    folder,
    projectName: projectName?.trim() || null,
  });
}

export async function attachFolderToProject(
  projectId: string,
  folder: string,
  serviceName?: string,
): Promise<Service> {
  return invoke<Service>("attach_folder_to_project", {
    projectId,
    folder,
    serviceName: serviceName?.trim() || null,
  });
}

export async function refreshService(serviceId: string): Promise<Service> {
  return invoke<Service>("refresh_service", { serviceId });
}

export async function renameProject(projectId: string, newName: string): Promise<Project> {
  return invoke<Project>("rename_project", { projectId, newName });
}

export async function renameService(serviceId: string, newName: string): Promise<Service> {
  return invoke<Service>("rename_service", { serviceId, newName });
}

export async function setServicePmOverride(
  serviceId: string,
  pmOverride: PackageManager | null,
): Promise<Service> {
  return invoke<Service>("set_service_pm_override", { serviceId, pmOverride });
}

export async function relocateService(serviceId: string, newFolder: string): Promise<Service> {
  return invoke<Service>("relocate_service", { serviceId, newFolder });
}

export async function removeService(serviceId: string): Promise<void> {
  await invoke("remove_service", { serviceId });
}

export async function removeProject(projectId: string): Promise<void> {
  await invoke("remove_project", { projectId });
}

export async function scanFolder(
  root: string,
  maxDepth = 3,
): Promise<ScanResult> {
  return invoke<ScanResult>("scan_folder", { root, maxDepth });
}

export async function registerGroupedProject(
  projectName: string,
  folders: string[],
  rootPath?: string | null,
): Promise<Project> {
  return invoke<Project>("register_grouped_project", {
    projectName,
    folders,
    rootPath: rootPath ?? null,
  });
}

export async function onProjectsChanged(handler: () => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen("projects:changed", () => {
    handler();
  });
}
