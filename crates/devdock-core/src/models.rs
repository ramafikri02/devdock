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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedEnvEntry {
    pub key: String,
    pub value: String,
    pub source: String,
    pub layer_kind: String,
    pub is_secret: bool,
    pub is_unknown: bool,
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
