use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Npm,
    Pnpm,
    Yarn,
    Bun,
}

impl PackageManager {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Npm => "npm",
            Self::Pnpm => "pnpm",
            Self::Yarn => "yarn",
            Self::Bun => "bun",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "npm" => Some(Self::Npm),
            "pnpm" => Some(Self::Pnpm),
            "yarn" => Some(Self::Yarn),
            "bun" => Some(Self::Bun),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Framework {
    NextJs,
    Vite,
    Nuxt,
    Astro,
    SvelteKit,
    Remix,
    NestJs,
    Express,
    Fastify,
    Hono,
    Unknown,
}

impl Framework {
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::NextJs => "Next.js",
            Self::Vite => "Vite",
            Self::Nuxt => "Nuxt",
            Self::Astro => "Astro",
            Self::SvelteKit => "SvelteKit",
            Self::Remix => "Remix",
            Self::NestJs => "NestJS",
            Self::Express => "Express",
            Self::Fastify => "Fastify",
            Self::Hono => "Hono",
            Self::Unknown => "Node.js",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PortInjectionMethod {
    Env,
    Flag,
    Both,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortStrategy {
    pub default_port: u16,
    pub method: PortInjectionMethod,
    pub flag_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceDescriptor {
    pub adapter: String,
    pub name: String,
    pub package_manager: PackageManager,
    pub framework: Framework,
    pub scripts: BTreeMap<String, String>,
    pub workspace_packages: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub services: Vec<Service>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub path: String,
    pub adapter: String,
    pub start_order: i32,
    pub default_script: Option<String>,
    pub pm_override: Option<PackageManager>,
    pub port: Option<u16>,
    pub port_injection: Option<PortInjectionMethod>,
    pub node_version_override: Option<String>,
    pub detected_pm: PackageManager,
    pub detected_framework: Framework,
    pub scripts: BTreeMap<String, String>,
    pub auto_restart_scripts: Vec<String>,
    pub is_missing: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBootstrapInfo {
    pub version: String,
    pub schema_version: i32,
    pub db_path: String,
    pub shell_path: String,
    pub theme: String,
    pub adapters: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanCandidateKind {
    Service,
    Monorepo,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanWorkspacePackage {
    pub name: String,
    pub path: String,
    pub package_manager: PackageManager,
    pub framework: Framework,
    pub script_count: usize,
    pub already_registered: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCandidate {
    pub kind: ScanCandidateKind,
    pub name: String,
    pub path: String,
    pub adapter: String,
    pub package_manager: PackageManager,
    pub framework: Framework,
    pub script_count: usize,
    pub already_registered: bool,
    pub workspace_packages: Vec<ScanWorkspacePackage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub root_path: String,
    pub max_depth: usize,
    pub scanned_dirs: usize,
    pub candidates: Vec<ScanCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvFileInfo {
    pub name: String,
    pub path: String,
    pub exists: bool,
    pub key_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    Postgres,
    Mysql,
    Mongodb,
    Redis,
}

impl DbKind {
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Postgres => "PostgreSQL",
            Self::Mysql => "MySQL",
            Self::Mongodb => "MongoDB",
            Self::Redis => "Redis",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbTestResult {
    pub key: String,
    pub kind: DbKind,
    pub ok: bool,
    pub latency_ms: u64,
    pub server_info: Option<String>,
    pub error: Option<String>,
    pub display_target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedEnvEntry {
    pub key: String,
    pub value: String,
    pub source: String,
    pub layer_kind: String,
    pub is_secret: bool,
    pub is_unknown: bool,
    pub detected_db_kind: Option<DbKind>,
    pub overridden_sources: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingEnvKey {
    pub key: String,
    pub example_value: String,
    pub is_secret: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetEntryInput {
    pub key: String,
    pub value: String,
    pub is_secret: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetEntry {
    pub id: String,
    pub key: String,
    pub value: String,
    pub is_secret: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetUsage {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub project_id: String,
    pub project_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvPreset {
    pub id: String,
    pub name: String,
    pub entries: Vec<PresetEntry>,
    pub usages: Vec<PresetUsage>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedPreset {
    pub preset_id: String,
    pub preset_name: String,
    pub position: i32,
    pub entry_count: usize,
    pub secret_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPresetEnvEntry {
    pub key: String,
    pub value: String,
    pub source: String,
    pub is_secret: bool,
    pub detected_db_kind: Option<DbKind>,
    pub overridden_sources: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEnvSummary {
    pub project_id: String,
    pub presets: Vec<AttachedPreset>,
    pub entries: Vec<ProjectPresetEnvEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceEnvInspection {
    pub service_id: String,
    pub mode: String,
    pub available_modes: Vec<String>,
    pub files: Vec<EnvFileInfo>,
    pub project_presets: Vec<AttachedPreset>,
    pub service_presets: Vec<AttachedPreset>,
    pub assigned_port: Option<u16>,
    pub has_example_file: bool,
    pub entries: Vec<ResolvedEnvEntry>,
    pub missing_keys: Vec<MissingEnvKey>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvWriteResult {
    pub target_file: String,
    pub target_path: String,
    pub backup_path: Option<String>,
    pub written_keys: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageEntryKind {
    NodeModules,
    BuildCache,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanableFolder {
    pub name: String,
    pub path: String,
    pub kind: StorageEntryKind,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStorageReport {
    pub service_id: String,
    pub service_name: String,
    pub total_bytes: u64,
    pub node_modules_bytes: u64,
    pub build_cache_bytes: u64,
    pub source_bytes: u64,
    pub reclaimable_bytes: u64,
    pub cleanable_folders: Vec<CleanableFolder>,
    pub calculated_at: String,
    pub from_cache: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStorageSummary {
    pub project_id: String,
    pub project_name: String,
    pub total_bytes: u64,
    pub node_modules_bytes: u64,
    pub build_cache_bytes: u64,
    pub source_bytes: u64,
    pub reclaimable_bytes: u64,
    pub services: Vec<ServiceStorageReport>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalStorageSummary {
    pub total_bytes: u64,
    pub node_modules_bytes: u64,
    pub build_cache_bytes: u64,
    pub reclaimable_bytes: u64,
    pub service_count: usize,
    pub cached_service_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCleanResult {
    pub service_id: String,
    pub deleted_folder: String,
    pub freed_bytes: u64,
    pub updated_report: ServiceStorageReport,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessStatus {
    Starting,
    Running,
    Restarting,
    Stopping,
    Stopped,
    Crashed,
}

impl ProcessStatus {
    pub fn is_active(self) -> bool {
        matches!(
            self,
            Self::Starting | Self::Running | Self::Restarting | Self::Stopping
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub seq: u64,
    pub process_id: String,
    pub project_id: String,
    pub service_id: String,
    pub service_name: String,
    pub script: String,
    pub stream: LogStream,
    pub text: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub id: String,
    pub project_id: String,
    pub service_id: String,
    pub service_name: String,
    pub script: String,
    pub command: String,
    pub pid: Option<u32>,
    pub status: ProcessStatus,
    pub exit_code: Option<i32>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub duration_ms: Option<u64>,
    pub line_count: usize,
    pub auto_restart: bool,
    pub restart_count: u32,
    pub crash_reason: Option<String>,
    pub last_error_snippet: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashNotificationEvent {
    pub process_id: String,
    pub project_id: String,
    pub service_id: String,
    pub service_name: String,
    pub script: String,
    pub exit_code: Option<i32>,
    pub reason: String,
    pub last_error_snippet: Option<String>,
    pub auto_restart_exhausted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProcessEvent {
    StatusChanged(ProcessInfo),
    LogLine(LogLine),
    LogsCleared { process_id: String },
    CrashNotification(CrashNotificationEvent),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "lowercase")]
pub enum LogExportScope {
    Process(String),
    Project(String),
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeVersionSource {
    Nvmrc,
    NodeVersionFile,
    EnginesNode,
    ManualOverride,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeRuntimeStatus {
    NoRequirement,
    Matched,
    MissingInManager,
    MismatchNoManager,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceNodeRuntime {
    pub service_id: String,
    pub required_version: Option<String>,
    pub source: NodeVersionSource,
    pub detected_version: Option<String>,
    pub detected_source: NodeVersionSource,
    pub manual_override: Option<String>,
    pub version_manager: Option<String>,
    pub installed_versions: Vec<String>,
    pub matched_installed_version: Option<String>,
    pub active_node_version: Option<String>,
    pub status: NodeRuntimeStatus,
    pub warning: Option<String>,
    pub can_install: bool,
    pub install_target: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInstallProgress {
    pub version: String,
    pub manager: String,
    pub line: String,
    pub done: bool,
    pub ok: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInstallResult {
    pub version: String,
    pub manager: String,
    pub output_lines: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortOwnerInfo {
    pub pid: u32,
    pub process_name: String,
    pub devdock_process_id: Option<String>,
    pub devdock_service_id: Option<String>,
    pub devdock_service_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortCheckResult {
    pub service_id: String,
    pub port: u16,
    pub is_available: bool,
    pub owner: Option<PortOwnerInfo>,
    pub suggested_port: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningPortEntry {
    pub port: u16,
    pub address: String,
    pub pid: u32,
    pub process_name: String,
    pub is_devdock: bool,
    pub devdock_process_id: Option<String>,
    pub devdock_service_id: Option<String>,
    pub devdock_service_name: Option<String>,
    pub is_conflict: bool,
    pub conflict_service_id: Option<String>,
    pub conflict_service_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInspectorSnapshot {
    pub entries: Vec<ListeningPortEntry>,
    pub conflict_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricPoint {
    pub timestamp_ms: i64,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub process_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMetricSeries {
    pub process_id: String,
    pub project_id: String,
    pub service_id: String,
    pub script: String,
    pub current_cpu_percent: f32,
    pub current_memory_bytes: u64,
    pub tree_process_count: usize,
    pub history: Vec<MetricPoint>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceMetricSeries {
    pub service_id: String,
    pub project_id: String,
    pub current_cpu_percent: f32,
    pub current_memory_bytes: u64,
    pub history: Vec<MetricPoint>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetricSeries {
    pub project_id: String,
    pub current_cpu_percent: f32,
    pub current_memory_bytes: u64,
    pub history: Vec<MetricPoint>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSnapshot {
    pub sampled_at_ms: i64,
    pub total_cpu_percent: f32,
    pub total_memory_bytes: u64,
    pub global_history: Vec<MetricPoint>,
    pub by_process: std::collections::HashMap<String, ProcessMetricSeries>,
    pub by_service: std::collections::HashMap<String, ServiceMetricSeries>,
    pub by_project: std::collections::HashMap<String, ProjectMetricSeries>,
}
