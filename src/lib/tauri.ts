import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

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
  autoRestartScripts: string[];
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

export type ProcessStatus =
  | "starting"
  | "running"
  | "restarting"
  | "stopping"
  | "stopped"
  | "crashed";

export type LogStream = "stdout" | "stderr" | "system";

export interface LogLine {
  seq: number;
  processId: string;
  projectId: string;
  serviceId: string;
  serviceName: string;
  script: string;
  stream: LogStream;
  text: string;
  timestamp: string;
}

export interface ProcessInfo {
  id: string;
  projectId: string;
  serviceId: string;
  serviceName: string;
  script: string;
  command: string;
  pid: number | null;
  status: ProcessStatus;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  lineCount: number;
  autoRestart: boolean;
  restartCount: number;
  crashReason: string | null;
  lastErrorSnippet: string | null;
}

export interface CrashNotificationEvent {
  processId: string;
  projectId: string;
  serviceId: string;
  serviceName: string;
  script: string;
  exitCode: number | null;
  reason: string;
  lastErrorSnippet: string | null;
  autoRestartExhausted: boolean;
}

export type LogExportScopeKind = "process" | "project" | "all";

export type NodeVersionSource =
  | "nvmrc"
  | "node_version_file"
  | "engines_node"
  | "manual_override"
  | "none";

export type NodeRuntimeStatus =
  | "no_requirement"
  | "matched"
  | "missing_in_manager"
  | "mismatch_no_manager";

export interface ServiceNodeRuntime {
  serviceId: string;
  requiredVersion: string | null;
  source: NodeVersionSource;
  detectedVersion: string | null;
  detectedSource: NodeVersionSource;
  manualOverride: string | null;
  versionManager: string | null;
  installedVersions: string[];
  matchedInstalledVersion: string | null;
  activeNodeVersion: string | null;
  status: NodeRuntimeStatus;
  warning: string | null;
  canInstall: boolean;
  installTarget: string | null;
}

export interface NodeInstallProgress {
  version: string;
  manager: string;
  line: string;
  done: boolean;
  ok: boolean | null;
}

export interface NodeInstallResult {
  version: string;
  manager: string;
  outputLines: string[];
}

export type PortInjectionMethod = "env" | "flag" | "both";

export interface PortOwnerInfo {
  pid: number;
  processName: string;
  devdockProcessId: string | null;
  devdockServiceId: string | null;
  devdockServiceName: string | null;
}

export interface PortCheckResult {
  serviceId: string;
  port: number;
  isAvailable: boolean;
  owner: PortOwnerInfo | null;
  suggestedPort: number | null;
}

export interface ProcessPortConflict {
  processId: string;
  serviceId: string;
  script: string;
  conflictPort: number;
  requestedPort: number | null;
  isLikelyHardcoded: boolean;
  isPortAvailableNow: boolean;
  owner: PortOwnerInfo | null;
  suggestedPort: number | null;
}

export interface ListeningPortEntry {
  port: number;
  address: string;
  pid: number;
  processName: string;
  isDevdock: boolean;
  devdockProcessId: string | null;
  devdockServiceId: string | null;
  devdockServiceName: string | null;
  isConflict: boolean;
  conflictServiceId: string | null;
  conflictServiceName: string | null;
}

export interface PortInspectorSnapshot {
  entries: ListeningPortEntry[];
  conflictCount: number;
}

export interface MetricPoint {
  timestampMs: number;
  cpuPercent: number;
  memoryBytes: number;
  processCount: number;
}

export interface ProcessMetricSeries {
  processId: string;
  projectId: string;
  serviceId: string;
  script: string;
  currentCpuPercent: number;
  currentMemoryBytes: number;
  treeProcessCount: number;
  history: MetricPoint[];
}

export interface ServiceMetricSeries {
  serviceId: string;
  projectId: string;
  currentCpuPercent: number;
  currentMemoryBytes: number;
  history: MetricPoint[];
}

export interface ProjectMetricSeries {
  projectId: string;
  currentCpuPercent: number;
  currentMemoryBytes: number;
  history: MetricPoint[];
}

export interface MetricsSnapshot {
  sampledAtMs: number;
  totalCpuPercent: number;
  totalMemoryBytes: number;
  globalHistory: MetricPoint[];
  byProcess: Record<string, ProcessMetricSeries>;
  byService: Record<string, ServiceMetricSeries>;
  byProject: Record<string, ProjectMetricSeries>;
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

export async function pickFolderDialog(title = "Select Node.js project folder"): Promise<string | null> {
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

export async function setServiceNodeVersionOverride(
  serviceId: string,
  version: string | null,
): Promise<Service> {
  return invoke<Service>("set_service_node_version_override", {
    serviceId,
    version: version?.trim() ? version.trim() : null,
  });
}

export async function setScriptAutoRestart(
  serviceId: string,
  scriptName: string,
  enabled: boolean,
): Promise<Service> {
  return invoke<Service>("set_script_auto_restart", {
    serviceId,
    scriptName,
    enabled,
  });
}

export async function setServicePort(
  serviceId: string,
  port: number | null,
): Promise<Service> {
  return invoke<Service>("set_service_port", { serviceId, port });
}

export async function setServicePortInjection(
  serviceId: string,
  method: PortInjectionMethod | null,
): Promise<Service> {
  return invoke<Service>("set_service_port_injection", { serviceId, method });
}

export async function ensureServicePort(serviceId: string): Promise<number> {
  return invoke<number>("ensure_service_port", { serviceId });
}

export async function checkServicePort(
  serviceId: string,
): Promise<PortCheckResult> {
  if (!isTauriRuntime()) {
    return {
      serviceId,
      port: 3000,
      isAvailable: true,
      owner: null,
      suggestedPort: null,
    };
  }
  return invoke<PortCheckResult>("check_service_port", { serviceId });
}

export async function inspectProcessPortConflict(
  processId: string,
): Promise<ProcessPortConflict | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  return invoke<ProcessPortConflict | null>("inspect_process_port_conflict", {
    processId,
  });
}

export async function assignNextFreePort(serviceId: string): Promise<Service> {
  return invoke<Service>("assign_next_free_port", { serviceId });
}

export async function inspectListeningPorts(): Promise<PortInspectorSnapshot> {
  if (!isTauriRuntime()) {
    return { entries: [], conflictCount: 0 };
  }
  return invoke<PortInspectorSnapshot>("inspect_listening_ports");
}

export async function killPortOwner(pid: number): Promise<void> {
  await invoke("kill_port_owner", { pid });
}

export async function inspectServiceNodeRuntime(
  serviceId: string,
): Promise<ServiceNodeRuntime> {
  if (!isTauriRuntime()) {
    return {
      serviceId,
      requiredVersion: null,
      source: "none",
      detectedVersion: null,
      detectedSource: "none",
      manualOverride: null,
      versionManager: null,
      installedVersions: [],
      matchedInstalledVersion: null,
      activeNodeVersion: null,
      status: "no_requirement",
      warning: null,
      canInstall: false,
      installTarget: null,
    };
  }
  return invoke<ServiceNodeRuntime>("inspect_service_node_runtime", {
    serviceId,
  });
}

export async function installNodeVersion(
  version: string,
): Promise<NodeInstallResult> {
  return invoke<NodeInstallResult>("install_node_version", { version });
}

export async function onNodeInstallProgress(
  handler: (progress: NodeInstallProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<NodeInstallProgress>("node:install-progress", (event) => {
    handler(event.payload);
  });
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

export async function runServiceScript(
  serviceId: string,
  script: string,
): Promise<ProcessInfo> {
  return invoke<ProcessInfo>("run_service_script", { serviceId, script });
}

export async function stopProcess(processId: string): Promise<ProcessInfo> {
  return invoke<ProcessInfo>("stop_process", { processId });
}

export async function restartProcess(processId: string): Promise<ProcessInfo> {
  return invoke<ProcessInfo>("restart_process", { processId });
}

export async function listProcesses(): Promise<ProcessInfo[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<ProcessInfo[]>("list_processes");
}

export async function getProcessLogs(
  processId: string,
  filter?: string,
  stderrOnly = false,
): Promise<LogLine[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<LogLine[]>("get_process_logs", {
    processId,
    filter: filter?.trim() ? filter : null,
    stderrOnly,
  });
}

export async function getProjectLogs(
  projectId: string,
  filter?: string,
  stderrOnly = false,
): Promise<LogLine[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<LogLine[]>("get_project_logs", {
    projectId,
    filter: filter?.trim() ? filter : null,
    stderrOnly,
  });
}

export async function getAllLogs(
  filter?: string,
  stderrOnly = false,
): Promise<LogLine[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<LogLine[]>("get_all_logs", {
    filter: filter?.trim() ? filter : null,
    stderrOnly,
  });
}

export async function clearProcessLogs(processId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("clear_process_logs", { processId });
}

export async function clearProjectLogs(projectId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("clear_project_logs", { projectId });
}

export async function exportLogsToFile(
  scopeKind: LogExportScopeKind,
  scopeId: string | null,
  path: string,
  filter?: string,
  stderrOnly = false,
  stripAnsi = true,
): Promise<number> {
  return invoke<number>("export_logs_to_file", {
    scopeKind,
    scopeId,
    path,
    filter: filter?.trim() ? filter : null,
    stderrOnly,
    stripAnsi,
  });
}

export async function pickSaveLogFileDialog(
  defaultPath = "devdock.log",
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const selected = await save({
    title: "Save logs to file",
    defaultPath,
    filters: [
      { name: "Log Files", extensions: ["log", "txt"] },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

export async function onProcessStatus(
  handler: (info: ProcessInfo) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<ProcessInfo>("process:status", (event) => {
    handler(event.payload);
  });
}

export async function onProcessLog(
  handler: (line: LogLine) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<LogLine>("process:log", (event) => {
    handler(event.payload);
  });
}

export async function onProcessLogsCleared(
  handler: (payload: { processId: string }) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<{ processId: string }>("process:logs-cleared", (event) => {
    handler(event.payload);
  });
}

export async function onProcessCrashed(
  handler: (event: CrashNotificationEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<CrashNotificationEvent>("process:crashed", (event) => {
    handler(event.payload);
  });
}

export async function getMetricsSnapshot(): Promise<MetricsSnapshot> {
  if (!isTauriRuntime()) {
    return {
      sampledAtMs: Date.now(),
      totalCpuPercent: 0,
      totalMemoryBytes: 0,
      globalHistory: [],
      byProcess: {},
      byService: {},
      byProject: {},
    };
  }
  return invoke<MetricsSnapshot>("get_metrics_snapshot");
}

export type ProjectAggregateStatus =
  | "all_running"
  | "partial"
  | "crashed"
  | "stopped"
  | "starting"
  | "stopping";

export interface ProjectStatusSummary {
  projectId: string;
  status: ProjectAggregateStatus;
  runningServices: number;
  crashedServices: number;
  totalServices: number;
}

export type OrchestrationStepState =
  | "waiting"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "skipped"
  | "failed";

export interface ProjectOrchestrationStep {
  projectId: string;
  serviceId: string;
  serviceName: string;
  script: string | null;
  order: number;
  state: OrchestrationStepState;
  processId: string | null;
  error: string | null;
}

export interface ProjectOrchestrationResult {
  projectId: string;
  action: string;
  steps: ProjectOrchestrationStep[];
  startedProcessIds: string[];
  stoppedProcessIds: string[];
  status: ProjectStatusSummary;
}

export async function onMetricsSnapshot(
  handler: (snapshot: MetricsSnapshot) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<MetricsSnapshot>("metrics:snapshot", (event) => {
    handler(event.payload);
  });
}

export async function setServiceDefaultScript(
  serviceId: string,
  defaultScript: string | null,
): Promise<Service> {
  return invoke<Service>("set_service_default_script", {
    serviceId,
    defaultScript,
  });
}

export async function reorderProjectServices(
  projectId: string,
  serviceIds: string[],
): Promise<Project> {
  return invoke<Project>("reorder_project_services", {
    projectId,
    serviceIds,
  });
}

export async function startProjectAll(
  projectId: string,
): Promise<ProjectOrchestrationResult> {
  return invoke<ProjectOrchestrationResult>("start_project_all", { projectId });
}

export async function stopProjectAll(
  projectId: string,
): Promise<ProjectOrchestrationResult> {
  return invoke<ProjectOrchestrationResult>("stop_project_all", { projectId });
}

export async function restartProjectAll(
  projectId: string,
): Promise<ProjectOrchestrationResult> {
  return invoke<ProjectOrchestrationResult>("restart_project_all", {
    projectId,
  });
}

export async function cleanProjectBuildCaches(
  projectId: string,
): Promise<StorageCleanResult[]> {
  return invoke<StorageCleanResult[]>("clean_project_build_caches", {
    projectId,
  });
}

export interface ProxyRouteInfo {
  serviceId: string;
  serviceName: string;
  projectId: string;
  domain: string;
  targetPort: number;
  url: string;
  isRunning: boolean;
}

export interface ProxyStatus {
  enabled: boolean;
  running: boolean;
  preferredPort: number;
  boundPort: number | null;
  usedFallback: boolean;
  fallbackPort: number;
  error: string | null;
  routes: ProxyRouteInfo[];
}

export interface HostsSyncPreview {
  hostsPath: string;
  domains: string[];
  alreadySynced: boolean;
  managedBlock: string;
}

export interface HostsSyncResult {
  hostsPath: string;
  domainsWritten: number;
}

export async function onProjectOrchestration(
  handler: (step: ProjectOrchestrationStep) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<ProjectOrchestrationStep>("project:orchestration", (event) => {
    handler(event.payload);
  });
}

export async function getProxyStatus(): Promise<ProxyStatus> {
  if (!isTauriRuntime()) {
    return {
      enabled: false,
      running: false,
      preferredPort: 80,
      boundPort: null,
      usedFallback: false,
      fallbackPort: 2999,
      error: null,
      routes: [],
    };
  }
  return invoke<ProxyStatus>("get_proxy_status");
}

export async function setProxyEnabled(enabled: boolean): Promise<ProxyStatus> {
  return invoke<ProxyStatus>("set_proxy_enabled", { enabled });
}

export async function previewHostsSync(): Promise<HostsSyncPreview> {
  return invoke<HostsSyncPreview>("preview_hosts_sync");
}

export async function syncEtcHosts(): Promise<HostsSyncResult> {
  return invoke<HostsSyncResult>("sync_etc_hosts");
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await invoke("open_external_url", { url });
}

export interface GitStatusInfo {
  isGitRepo: boolean;
  branch: string | null;
  isDirty: boolean;
  changedFiles: number;
}

export interface DetectedTool {
  id: string;
  name: string;
  command: string;
  available: boolean;
}

export interface DesktopToolSettings {
  defaultEditor: string | null;
  defaultTerminal: string | null;
  detectedEditors: DetectedTool[];
  detectedTerminals: DetectedTool[];
}

export type QuickActionTarget = "editor" | "terminal" | "browser" | "file_manager";

export async function onProxyStatus(
  handler: (status: ProxyStatus) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<ProxyStatus>("proxy:status", (event) => {
    handler(event.payload);
  });
}

export async function getAllServicesGitInfo(): Promise<Record<string, GitStatusInfo>> {
  if (!isTauriRuntime()) {
    return {};
  }
  return invoke<Record<string, GitStatusInfo>>("get_all_services_git_info");
}

export async function getDesktopToolSettings(): Promise<DesktopToolSettings> {
  if (!isTauriRuntime()) {
    return {
      defaultEditor: "code",
      defaultTerminal: "terminal",
      detectedEditors: [],
      detectedTerminals: [],
    };
  }
  return invoke<DesktopToolSettings>("get_desktop_tool_settings");
}

export async function setDefaultEditor(
  editorId: string | null,
): Promise<DesktopToolSettings> {
  return invoke<DesktopToolSettings>("set_default_editor", { editorId });
}

export async function setDefaultTerminal(
  terminalId: string | null,
): Promise<DesktopToolSettings> {
  return invoke<DesktopToolSettings>("set_default_terminal", { terminalId });
}

export async function openServiceQuickAction(
  serviceId: string,
  target: QuickActionTarget,
): Promise<void> {
  await invoke("open_service_quick_action", { serviceId, target });
}

export async function confirmAppQuit(stopProcesses: boolean): Promise<void> {
  await invoke("confirm_app_quit", { stopProcesses });
}

export interface ExportSummary {
  formatVersion: number;
  projectCount: number;
  serviceCount: number;
  presetCount: number;
  secretCount: number;
  includesSecrets: boolean;
  outputPath: string;
}

export interface FolderRelocationCheck {
  path: string;
  exists: boolean;
  packageName: string | null;
  expectedPackageName: string | null;
  matchesPackageName: boolean;
  warning: string | null;
}

export interface ImportServiceResolution {
  projectName: string;
  serviceKey: string;
  serviceName: string;
  expectedPackageName: string | null;
  originalPath: string;
  resolvedPath: string;
  existsOnDisk: boolean;
  packageNameMatches: boolean;
  detectedPackageName: string | null;
  warning: string | null;
}

export interface ImportPreview {
  formatVersion: number;
  exportedAt: string;
  sourceOs: string;
  includesSecrets: boolean;
  passphraseVerified: boolean;
  projectCount: number;
  serviceCount: number;
  presetCount: number;
  secretCount: number;
  suggestedCommonParent: string | null;
  missingCount: number;
  services: ImportServiceResolution[];
}

export interface ImportResult {
  projectsImported: number;
  servicesImported: number;
  presetsImported: number;
  secretsStored: number;
  missingServices: number;
}

export async function onQuitRequested(
  handler: (payload: { activeCount: number }) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listen<{ activeCount: number }>("app:quit-requested", (event) => {
    handler(event.payload);
  });
}

export async function pickExportSaveDialog(
  defaultPath = "devdock-backup.json",
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const selected = await save({
    title: "Export DevDock configuration",
    defaultPath,
    filters: [{ name: "DevDock Backup", extensions: ["json"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickImportOpenDialog(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const selected = await open({
    title: "Select DevDock configuration file",
    multiple: false,
    filters: [{ name: "DevDock Backup", extensions: ["json"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function exportConfigToFile(
  outputPath: string,
  includeSecrets: boolean,
  passphrase?: string | null,
): Promise<ExportSummary> {
  return invoke<ExportSummary>("export_config_to_file", {
    outputPath,
    includeSecrets,
    passphrase: passphrase?.trim() ? passphrase : null,
  });
}

export async function previewImportFile(
  inputPath: string,
  passphrase?: string | null,
  oldParent?: string | null,
  newParent?: string | null,
  pathOverrides: Record<string, string> = {},
): Promise<ImportPreview> {
  return invoke<ImportPreview>("preview_import_file", {
    inputPath,
    passphrase: passphrase?.trim() ? passphrase : null,
    oldParent: oldParent?.trim() ? oldParent : null,
    newParent: newParent?.trim() ? newParent : null,
    pathOverrides,
  });
}

export async function applyImportFile(
  inputPath: string,
  passphrase?: string | null,
  oldParent?: string | null,
  newParent?: string | null,
  pathOverrides: Record<string, string> = {},
): Promise<ImportResult> {
  return invoke<ImportResult>("apply_import_file", {
    inputPath,
    passphrase: passphrase?.trim() ? passphrase : null,
    oldParent: oldParent?.trim() ? oldParent : null,
    newParent: newParent?.trim() ? newParent : null,
    pathOverrides,
  });
}

export async function validateRelocationFolder(
  folder: string,
  expectedPackageName?: string | null,
): Promise<FolderRelocationCheck> {
  return invoke<FolderRelocationCheck>("validate_relocation_folder", {
    folder,
    expectedPackageName: expectedPackageName ?? null,
  });
}
