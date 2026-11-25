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

export interface EnvFileInfo {
  name: string;
  path: string;
  exists: boolean;
  keyCount: number;
}

export type DbKind = "postgres" | "mysql" | "mongodb" | "redis";

export interface DbTestResult {
  key: string;
  kind: DbKind;
  ok: boolean;
  latencyMs: number;
  serverInfo: string | null;
  error: string | null;
  displayTarget: string;
}

export interface ResolvedEnvEntry {
  key: string;
  value: string;
  source: string;
  layerKind: "shell" | "file" | "project_preset" | "service_preset" | "port" | string;
  isSecret: boolean;
  isUnknown: boolean;
  detectedDbKind: DbKind | null;
  overriddenSources: string[];
}

export interface MissingEnvKey {
  key: string;
  exampleValue: string;
  isSecret: boolean;
}

export interface PresetEntryInput {
  key: string;
  value: string;
  isSecret: boolean;
}

export interface PresetEntry {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
}

export interface PresetUsage {
  kind: "project" | "service" | string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
}

export interface EnvPreset {
  id: string;
  name: string;
  entries: PresetEntry[];
  usages: PresetUsage[];
  createdAt: string;
  updatedAt: string;
}

export interface AttachedPreset {
  presetId: string;
  presetName: string;
  position: number;
  entryCount: number;
  secretCount: number;
}

export interface ProjectPresetEnvEntry {
  key: string;
  value: string;
  source: string;
  isSecret: boolean;
  detectedDbKind: DbKind | null;
  overriddenSources: string[];
}

export interface ProjectEnvSummary {
  projectId: string;
  presets: AttachedPreset[];
  entries: ProjectPresetEnvEntry[];
}

export interface ServiceEnvInspection {
  serviceId: string;
  mode: string;
  availableModes: string[];
  files: EnvFileInfo[];
  projectPresets: AttachedPreset[];
  servicePresets: AttachedPreset[];
  assignedPort: number | null;
  hasExampleFile: boolean;
  entries: ResolvedEnvEntry[];
  missingKeys: MissingEnvKey[];
}

export interface EnvWriteResult {
  targetFile: string;
  targetPath: string;
  backupPath: string | null;
  writtenKeys: number;
}

export type StorageEntryKind = "node_modules" | "build_cache";

export interface CleanableFolder {
  name: string;
  path: string;
  kind: StorageEntryKind;
  sizeBytes: number;
}

export interface ServiceStorageReport {
  serviceId: string;
  serviceName: string;
  totalBytes: number;
  nodeModulesBytes: number;
  buildCacheBytes: number;
  sourceBytes: number;
  reclaimableBytes: number;
  cleanableFolders: CleanableFolder[];
  calculatedAt: string;
  fromCache: boolean;
}

export interface ProjectStorageSummary {
  projectId: string;
  projectName: string;
  totalBytes: number;
  nodeModulesBytes: number;
  buildCacheBytes: number;
  sourceBytes: number;
  reclaimableBytes: number;
  services: ServiceStorageReport[];
}

export interface GlobalStorageSummary {
  totalBytes: number;
  nodeModulesBytes: number;
  buildCacheBytes: number;
  reclaimableBytes: number;
  serviceCount: number;
  cachedServiceCount: number;
}

export interface StorageCleanResult {
  serviceId: string;
  deletedFolder: string;
  freedBytes: number;
  updatedReport: ServiceStorageReport;
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

export async function inspectServiceEnv(
  serviceId: string,
  mode?: string,
): Promise<ServiceEnvInspection> {
  return invoke<ServiceEnvInspection>("inspect_service_env", {
    serviceId,
    mode: mode ?? null,
  });
}

export async function writeServiceEnv(
  serviceId: string,
  targetFile: string,
  entries: Record<string, string>,
): Promise<EnvWriteResult> {
  return invoke<EnvWriteResult>("write_service_env", {
    serviceId,
    targetFile,
    entries,
  });
}

export async function updateServiceEnvKey(
  serviceId: string,
  targetFile: string,
  key: string,
  value: string,
): Promise<EnvWriteResult> {
  return invoke<EnvWriteResult>("update_service_env_key", {
    serviceId,
    targetFile,
    key,
    value,
  });
}

export async function listPresets(): Promise<EnvPreset[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<EnvPreset[]>("list_presets");
}

export async function createPreset(
  name: string,
  entries: PresetEntryInput[],
): Promise<EnvPreset> {
  return invoke<EnvPreset>("create_preset", { name, entries });
}

export async function updatePreset(
  presetId: string,
  name: string,
  entries: PresetEntryInput[],
): Promise<EnvPreset> {
  return invoke<EnvPreset>("update_preset", { presetId, name, entries });
}

export async function deletePreset(presetId: string): Promise<void> {
  await invoke("delete_preset", { presetId });
}

export async function attachPresetToProject(
  projectId: string,
  presetId: string,
): Promise<AttachedPreset[]> {
  return invoke<AttachedPreset[]>("attach_preset_to_project", {
    projectId,
    presetId,
  });
}

export async function detachPresetFromProject(
  projectId: string,
  presetId: string,
): Promise<AttachedPreset[]> {
  return invoke<AttachedPreset[]>("detach_preset_from_project", {
    projectId,
    presetId,
  });
}

export async function reorderProjectPresets(
  projectId: string,
  presetIds: string[],
): Promise<AttachedPreset[]> {
  return invoke<AttachedPreset[]>("reorder_project_presets", {
    projectId,
    presetIds,
  });
}

export async function attachPresetToService(
  serviceId: string,
  presetId: string,
): Promise<AttachedPreset[]> {
  return invoke<AttachedPreset[]>("attach_preset_to_service", {
    serviceId,
    presetId,
  });
}

export async function detachPresetFromService(
  serviceId: string,
  presetId: string,
): Promise<AttachedPreset[]> {
  return invoke<AttachedPreset[]>("detach_preset_from_service", {
    serviceId,
    presetId,
  });
}

export async function reorderServicePresets(
  serviceId: string,
  presetIds: string[],
): Promise<AttachedPreset[]> {
  return invoke<AttachedPreset[]>("reorder_service_presets", {
    serviceId,
    presetIds,
  });
}

export async function inspectProjectSharedEnv(
  projectId: string,
): Promise<ProjectEnvSummary> {
  return invoke<ProjectEnvSummary>("inspect_project_shared_env", { projectId });
}

export async function testServiceDbConnection(
  serviceId: string,
  key: string,
  mode?: string,
  valueOverride?: string,
): Promise<DbTestResult> {
  return invoke<DbTestResult>("test_service_db_connection", {
    serviceId,
    key,
    mode: mode ?? null,
    valueOverride: valueOverride ?? null,
  });
}

export async function testProjectDbConnection(
  projectId: string,
  key: string,
): Promise<DbTestResult> {
  return invoke<DbTestResult>("test_project_db_connection", {
    projectId,
    key,
  });
}

export async function analyzeServiceStorage(
  serviceId: string,
  forceRefresh = false,
): Promise<ServiceStorageReport> {
  return invoke<ServiceStorageReport>("analyze_service_storage", {
    serviceId,
    forceRefresh,
  });
}

export async function analyzeProjectStorage(
  projectId: string,
  forceRefresh = false,
): Promise<ProjectStorageSummary> {
  return invoke<ProjectStorageSummary>("analyze_project_storage", {
    projectId,
    forceRefresh,
  });
}

export async function getCachedGlobalStorage(): Promise<GlobalStorageSummary> {
  if (!isTauriRuntime()) {
    return {
      totalBytes: 0,
      nodeModulesBytes: 0,
      buildCacheBytes: 0,
      reclaimableBytes: 0,
      serviceCount: 0,
      cachedServiceCount: 0,
    };
  }
  return invoke<GlobalStorageSummary>("get_cached_global_storage");
}

export async function analyzeAllStorage(
  forceRefresh = false,
): Promise<GlobalStorageSummary> {
  if (!isTauriRuntime()) {
    return {
      totalBytes: 0,
      nodeModulesBytes: 0,
      buildCacheBytes: 0,
      reclaimableBytes: 0,
      serviceCount: 0,
      cachedServiceCount: 0,
    };
  }
  return invoke<GlobalStorageSummary>("analyze_all_storage", { forceRefresh });
}

export async function cleanServiceStorage(
  serviceId: string,
  folderName: string,
): Promise<StorageCleanResult> {
  return invoke<StorageCleanResult>("clean_service_storage", {
    serviceId,
    folderName,
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
