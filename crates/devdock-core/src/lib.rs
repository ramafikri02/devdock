pub mod adapter;
pub mod db;
pub mod db_tester;
pub mod env_resolver;
pub mod error;
pub mod git_info;
pub mod log_buffer;
pub mod models;
pub mod monitor;
pub mod ports;
pub mod presets;
pub mod process_manager;
pub mod proxy;
pub mod quick_actions;
pub mod registry;
pub mod runtime;
pub mod scanner;
pub mod secret_store;
pub mod shell_env;
pub mod storage;
pub mod traits;

use crate::adapter::{AdapterRegistry, ProjectAdapter};
use crate::db::Database;
use crate::db_tester::{DbConnectionTester, DEFAULT_DB_TIMEOUT};
use crate::env_resolver::EnvResolver;
use crate::error::{CoreError, CoreResult};
use crate::log_buffer::DEFAULT_LOG_CAPACITY;
use crate::models::{
    AppBootstrapInfo, AttachedPreset, DbTestResult, DesktopToolSettings, EnvPreset, EnvWriteResult,
    GitStatusInfo, GlobalStorageSummary, HostsSyncPreview, HostsSyncResult, LogExportScope,
    LogLine, MetricsSnapshot, NodeInstallProgress, NodeInstallResult, OrchestrationStepState,
    PackageManager, PortCheckResult, PortInjectionMethod, PortInspectorSnapshot, PresetEntryInput,
    ProcessEvent, ProcessInfo, ProcessStatus, Project, ProjectAggregateStatus, ProjectEnvSummary,
    ProjectOrchestrationResult, ProjectOrchestrationStep, ProjectStatusSummary,
    ProjectStorageSummary, ProxyStatus, QuickActionTarget, ScanResult, Service, ServiceDescriptor,
    ServiceEnvInspection, ServiceNodeRuntime, ServiceStorageReport, StorageCleanResult,
    StorageEntryKind,
};
use crate::monitor::ResourceMonitor;
use crate::ports::PortManager;
use crate::presets::PresetStore;
use crate::process_manager::{
    AutoRestartPolicy, ProcessEventListener, ProcessManager, DEFAULT_STOP_GRACE_PERIOD,
};
use crate::proxy::{
    format_local_domain_url, open_url_in_browser, preview_hosts_sync_at, service_domain_slug,
    sync_hosts_file_elevated, system_hosts_path, LocalDomainProxy, DEFAULT_PROXY_FALLBACK_PORT,
    DEFAULT_PROXY_PREFERRED_PORT,
};
use crate::quick_actions::{
    detect_tools, open_folder_in_editor, open_folder_in_file_manager, open_folder_in_terminal,
};
use crate::registry::ProjectRegistry;
use crate::runtime::{prepend_dir_to_path, RuntimeResolver};
use crate::scanner::FolderScanner;
use crate::shell_env::LoginShellEnvProvider;
use crate::storage::StorageAnalyzer;
use crate::traits::{
    InMemoryNotifier, InMemorySecretStore, InMemoryShellEnvProvider, Notifier, SecretStore,
    ShellEnvProvider,
};
use rusqlite::{params, OptionalExtension};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

pub struct DevDockCore {
    db: Database,
    secrets: Arc<dyn SecretStore>,
    shell_env: Arc<dyn ShellEnvProvider>,
    notifier: Arc<dyn Notifier>,
    adapters: AdapterRegistry,
    storage: StorageAnalyzer,
    processes: ProcessManager,
    runtime: RuntimeResolver,
    monitor: ResourceMonitor,
    proxy: LocalDomainProxy,
}

impl DevDockCore {
    pub fn new(
        db_path: &Path,
        secrets: Arc<dyn SecretStore>,
        shell_env: Arc<dyn ShellEnvProvider>,
        notifier: Arc<dyn Notifier>,
    ) -> CoreResult<Self> {
        let db = Database::open(db_path)?;
        let processes = ProcessManager::new(
            DEFAULT_LOG_CAPACITY,
            DEFAULT_STOP_GRACE_PERIOD,
            Arc::clone(&notifier),
        );
        Ok(Self {
            db,
            secrets,
            shell_env,
            notifier,
            adapters: AdapterRegistry::default(),
            storage: StorageAnalyzer::new(),
            processes,
            runtime: RuntimeResolver::new(),
            monitor: ResourceMonitor::default(),
            proxy: LocalDomainProxy::new(),
        })
    }

    /// Convenience constructor for production desktop apps using SQLite on disk
    /// and the real `LoginShellEnvProvider`.
    pub fn open_desktop(
        db_path: &Path,
        secrets: Arc<dyn SecretStore>,
        notifier: Arc<dyn Notifier>,
    ) -> CoreResult<Self> {
        Self::new(
            db_path,
            secrets,
            Arc::new(LoginShellEnvProvider::new()),
            notifier,
        )
    }

    /// Convenience constructor for integration tests using an in-memory SQLite DB
    /// and in-memory OS fakes.
    pub fn in_memory_for_tests(initial_path: &str) -> CoreResult<Self> {
        let db = Database::open_in_memory()?;
        let notifier: Arc<dyn Notifier> = Arc::new(InMemoryNotifier::new());
        let processes = ProcessManager::new(
            DEFAULT_LOG_CAPACITY,
            DEFAULT_STOP_GRACE_PERIOD,
            Arc::clone(&notifier),
        );
        Ok(Self {
            db,
            secrets: Arc::new(InMemorySecretStore::new()),
            shell_env: Arc::new(InMemoryShellEnvProvider::new(initial_path)),
            notifier,
            adapters: AdapterRegistry::default(),
            storage: StorageAnalyzer::new(),
            processes,
            runtime: RuntimeResolver::new(),
            monitor: ResourceMonitor::default(),
            proxy: LocalDomainProxy::new(),
        })
    }

    pub fn in_memory_for_tests_with_notifier(
        initial_path: &str,
        notifier: Arc<dyn Notifier>,
    ) -> CoreResult<Self> {
        let db = Database::open_in_memory()?;
        let processes = ProcessManager::new(
            DEFAULT_LOG_CAPACITY,
            DEFAULT_STOP_GRACE_PERIOD,
            Arc::clone(&notifier),
        );
        Ok(Self {
            db,
            secrets: Arc::new(InMemorySecretStore::new()),
            shell_env: Arc::new(InMemoryShellEnvProvider::new(initial_path)),
            notifier,
            adapters: AdapterRegistry::default(),
            storage: StorageAnalyzer::new(),
            processes,
            runtime: RuntimeResolver::new(),
            monitor: ResourceMonitor::default(),
            proxy: LocalDomainProxy::new(),
        })
    }

    pub fn in_memory_for_tests_with_limits(
        initial_path: &str,
        log_capacity: usize,
        stop_grace_period: Duration,
    ) -> CoreResult<Self> {
        let db = Database::open_in_memory()?;
        let notifier: Arc<dyn Notifier> = Arc::new(InMemoryNotifier::new());
        let processes = ProcessManager::new(log_capacity, stop_grace_period, Arc::clone(&notifier));
        Ok(Self {
            db,
            secrets: Arc::new(InMemorySecretStore::new()),
            shell_env: Arc::new(InMemoryShellEnvProvider::new(initial_path)),
            notifier,
            adapters: AdapterRegistry::default(),
            storage: StorageAnalyzer::new(),
            processes,
            runtime: RuntimeResolver::new(),
            monitor: ResourceMonitor::default(),
            proxy: LocalDomainProxy::new(),
        })
    }

    pub fn sample_metrics(&self) -> MetricsSnapshot {
        let procs = self.list_processes();
        self.monitor.sample_now(&procs)
    }

    pub fn get_metrics_snapshot(&self) -> MetricsSnapshot {
        self.monitor
            .last_snapshot()
            .unwrap_or_else(|| self.sample_metrics())
    }

    pub fn set_auto_restart_policy(&self, policy: AutoRestartPolicy) {
        self.processes.set_auto_restart_policy(policy);
    }

    pub fn db_path(&self) -> String {
        self.db.path().display().to_string()
    }

    pub fn schema_version(&self) -> CoreResult<i32> {
        self.db.schema_version()
    }

    pub fn secrets(&self) -> &Arc<dyn SecretStore> {
        &self.secrets
    }

    pub fn shell_env(&self) -> &Arc<dyn ShellEnvProvider> {
        &self.shell_env
    }

    pub fn notifier(&self) -> &Arc<dyn Notifier> {
        &self.notifier
    }

    pub fn shell_path(&self) -> CoreResult<String> {
        self.shell_env.get_path()
    }

    pub fn refresh_shell_path(&self) -> CoreResult<String> {
        self.shell_env.refresh()
    }

    pub fn list_adapters(&self) -> Vec<String> {
        self.adapters.list_ids()
    }

    pub fn detect_adapter(&self, folder: &Path) -> Option<Arc<dyn ProjectAdapter>> {
        self.adapters.detect(folder)
    }

    pub fn describe_folder(&self, folder: &Path) -> CoreResult<ServiceDescriptor> {
        let adapter = self.adapters.detect(folder).ok_or_else(|| {
            CoreError::InvalidFolder(format!(
                "No supported project adapter matched {}",
                folder.display()
            ))
        })?;
        adapter.describe(folder)
    }

    pub fn get_setting(&self, key: &str) -> CoreResult<Option<String>> {
        self.db.with_conn(|conn| {
            let value = conn
                .query_row(
                    "SELECT value FROM setting WHERE key = ?1",
                    params![key],
                    |row| row.get(0),
                )
                .optional()?;
            Ok(value)
        })
    }

    pub fn set_setting(&self, key: &str, value: &str) -> CoreResult<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO setting (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
            Ok(())
        })
    }

    pub fn bootstrap_info(&self) -> CoreResult<AppBootstrapInfo> {
        let theme = self
            .get_setting("theme")?
            .unwrap_or_else(|| "dark".to_string());
        Ok(AppBootstrapInfo {
            version: env!("CARGO_PKG_VERSION").to_string(),
            schema_version: self.schema_version()?,
            db_path: self.db_path(),
            shell_path: self.shell_path()?,
            theme,
            adapters: self.list_adapters(),
        })
    }

    fn registry(&self) -> ProjectRegistry<'_> {
        ProjectRegistry::new(&self.db, &self.adapters)
    }

    fn presets(&self) -> PresetStore<'_> {
        PresetStore::new(&self.db, &self.secrets)
    }

    pub fn set_service_port(&self, service_id: &str, port: Option<u16>) -> CoreResult<Service> {
        self.registry().set_service_port(service_id, port)
    }

    pub fn set_service_port_injection(
        &self,
        service_id: &str,
        method: Option<PortInjectionMethod>,
    ) -> CoreResult<Service> {
        self.registry()
            .set_service_port_injection(service_id, method)
    }

    pub fn ensure_service_port(&self, service_id: &str) -> CoreResult<u16> {
        self.registry().ensure_service_port(service_id)
    }

    pub fn check_service_port(&self, service_id: &str) -> CoreResult<PortCheckResult> {
        let service = self.get_service(service_id)?;
        let port = match service.port {
            Some(p) => p,
            None => self
                .adapters
                .get(&service.adapter)
                .map(|a| a.port_strategy(&service.detected_framework).default_port)
                .unwrap_or(3000),
        };
        let all_services: Vec<Service> = self
            .list_projects()?
            .into_iter()
            .flat_map(|p| p.services)
            .collect();
        let processes = self.list_processes();
        PortManager::check_service_port(&service, port, &all_services, &processes)
    }

    pub fn assign_next_free_port(&self, service_id: &str) -> CoreResult<Service> {
        let service = self.get_service(service_id)?;
        let all_services: Vec<Service> = self
            .list_projects()?
            .into_iter()
            .flat_map(|p| p.services)
            .collect();
        let reserved: std::collections::HashSet<u16> = all_services
            .iter()
            .filter(|s| s.id != service.id)
            .filter_map(|s| s.port)
            .collect();
        let base = service
            .port
            .map(|p| p.saturating_add(1))
            .unwrap_or_else(|| {
                self.adapters
                    .get(&service.adapter)
                    .map(|a| a.port_strategy(&service.detected_framework).default_port)
                    .unwrap_or(3000)
            });
        let next = PortManager::find_next_free_port(base, &reserved).ok_or_else(|| {
            CoreError::Adapter("No free local TCP port available".to_string())
        })?;
        self.set_service_port(service_id, Some(next))
    }

    pub fn inspect_listening_ports(&self) -> CoreResult<PortInspectorSnapshot> {
        let all_services: Vec<Service> = self
            .list_projects()?
            .into_iter()
            .flat_map(|p| p.services)
            .collect();
        let processes = self.list_processes();
        PortManager::inspect_listening_ports(&all_services, &processes)
    }

    pub fn kill_port_owner(&self, pid: u32) -> CoreResult<()> {
        // If this PID belongs to an active DevDock process, stop it cleanly via ProcessManager
        if let Some(proc) = self
            .list_processes()
            .into_iter()
            .find(|p| p.status.is_active() && p.pid == Some(pid))
        {
            self.stop_process(&proc.id)?;
            return Ok(());
        }
        PortManager::kill_pid(pid)
    }

    pub fn preview_service_run_spec(
        &self,
        service_id: &str,
        script: &str,
    ) -> CoreResult<(crate::models::RunCommandSpec, std::collections::BTreeMap<String, String>)> {
        let service = self.get_service(service_id)?;
        let adapter = self.adapters.get(&service.adapter).ok_or_else(|| {
            CoreError::Adapter(format!("Unknown adapter '{}'", service.adapter))
        })?;
        let mut env_map = self.resolve_service_runtime_env(service_id, None)?;
        let base_path = env_map
            .get("PATH")
            .cloned()
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| self.shell_env.get_path().unwrap_or_default());

        let runtime_bin_dir = self
            .runtime
            .resolve_runtime_bin_dir(&service, &base_path)
            .ok()
            .flatten();

        if let Some(bin_dir) = &runtime_bin_dir {
            let updated_path = prepend_dir_to_path(bin_dir, &base_path);
            env_map.insert("PATH".to_string(), updated_path);
        } else if !env_map.contains_key("PATH") && !base_path.is_empty() {
            env_map.insert("PATH".to_string(), base_path);
        }

        let mut spec = adapter.build_run_command(&service, script, runtime_bin_dir.as_deref())?;

        if let Some(port) = service.port {
            let strategy = adapter.port_strategy(&service.detected_framework);
            let method = service
                .port_injection
                .clone()
                .unwrap_or(strategy.method);
            let pm = service
                .pm_override
                .as_ref()
                .unwrap_or(&service.detected_pm);
            PortManager::apply_port_injection(
                &mut spec,
                &mut env_map,
                pm,
                port,
                method,
                strategy.flag_name.as_deref(),
            );
        }

        Ok((spec, env_map))
    }

    pub fn set_service_node_version_override(
        &self,
        service_id: &str,
        version: Option<&str>,
    ) -> CoreResult<Service> {
        self.registry()
            .set_service_node_version_override(service_id, version)
    }

    pub fn set_script_auto_restart(
        &self,
        service_id: &str,
        script_name: &str,
        enabled: bool,
    ) -> CoreResult<Service> {
        self.registry()
            .set_script_auto_restart(service_id, script_name, enabled)
    }

    pub fn set_service_default_script(
        &self,
        service_id: &str,
        default_script: Option<&str>,
    ) -> CoreResult<Service> {
        self.registry()
            .set_service_default_script(service_id, default_script)
    }

    pub fn reorder_project_services(
        &self,
        project_id: &str,
        service_ids: &[String],
    ) -> CoreResult<Project> {
        self.registry()
            .reorder_project_services(project_id, service_ids)
    }

    pub fn inspect_service_node_runtime(&self, service_id: &str) -> CoreResult<ServiceNodeRuntime> {
        let service = self.get_service(service_id)?;
        let path_env = self.shell_env.get_path()?;
        Ok(self.runtime.inspect_service(&service, &path_env))
    }

    pub fn install_node_version(
        &self,
        version: &str,
        on_progress: Option<Arc<dyn Fn(NodeInstallProgress) + Send + Sync>>,
    ) -> CoreResult<NodeInstallResult> {
        let path_env = self.shell_env.get_path()?;
        self.runtime
            .install_version(version, &path_env, on_progress)
    }

    pub fn register_folder_as_project(
        &self,
        folder: &Path,
        project_name: Option<&str>,
    ) -> CoreResult<Project> {
        self.registry()
            .register_folder_as_project(folder, project_name)
    }

    pub fn attach_folder_to_project(
        &self,
        project_id: &str,
        folder: &Path,
        service_name: Option<&str>,
    ) -> CoreResult<Service> {
        self.registry()
            .attach_folder_to_project(project_id, folder, service_name)
    }

    pub fn list_projects(&self) -> CoreResult<Vec<Project>> {
        self.registry().list_projects()
    }

    pub fn get_project(&self, project_id: &str) -> CoreResult<Project> {
        self.registry().get_project(project_id)
    }

    pub fn get_service(&self, service_id: &str) -> CoreResult<Service> {
        self.registry().get_service(service_id)
    }

    pub fn refresh_service(&self, service_id: &str) -> CoreResult<Service> {
        self.registry().refresh_service(service_id)
    }

    pub fn rename_project(&self, project_id: &str, new_name: &str) -> CoreResult<Project> {
        self.registry().rename_project(project_id, new_name)
    }

    pub fn rename_service(&self, service_id: &str, new_name: &str) -> CoreResult<Service> {
        self.registry().rename_service(service_id, new_name)
    }

    pub fn set_service_pm_override(
        &self,
        service_id: &str,
        pm_override: Option<PackageManager>,
    ) -> CoreResult<Service> {
        self.registry()
            .set_service_pm_override(service_id, pm_override)
    }

    pub fn relocate_service(&self, service_id: &str, new_folder: &Path) -> CoreResult<Service> {
        self.registry().relocate_service(service_id, new_folder)
    }

    pub fn remove_service(&self, service_id: &str) -> CoreResult<()> {
        self.registry().remove_service(service_id)
    }

    pub fn remove_project(&self, project_id: &str) -> CoreResult<()> {
        self.registry().remove_project(project_id)
    }

    pub fn scan_folder(&self, root: &Path, max_depth: Option<usize>) -> CoreResult<ScanResult> {
        FolderScanner::new(&self.db, &self.adapters).scan(root, max_depth)
    }

    pub fn register_grouped_project(
        &self,
        project_name: &str,
        folders: &[std::path::PathBuf],
        root_path: Option<&Path>,
    ) -> CoreResult<Project> {
        self.registry()
            .register_grouped_project(project_name, folders, root_path)
    }

    pub fn inspect_service_env(
        &self,
        service_id: &str,
        mode: Option<&str>,
    ) -> CoreResult<ServiceEnvInspection> {
        let service = self.get_service(service_id)?;
        let shell_env = self.shell_env.get_env()?;
        let store = self.presets();
        let project_attached = store.list_project_presets(&service.project_id)?;
        let service_attached = store.list_service_presets(&service.id)?;
        let project_presets = store.resolve_project_presets_full(&service.project_id)?;
        let service_presets = store.resolve_service_presets_full(&service.id)?;
        EnvResolver::inspect_service(
            &service,
            mode,
            &shell_env,
            &project_presets,
            &service_presets,
            project_attached,
            service_attached,
        )
    }

    pub fn resolve_service_runtime_env(
        &self,
        service_id: &str,
        mode: Option<&str>,
    ) -> CoreResult<std::collections::BTreeMap<String, String>> {
        let service = self.get_service(service_id)?;
        let shell_env = self.shell_env.get_env()?;
        let store = self.presets();
        let project_presets = store.resolve_project_presets_full(&service.project_id)?;
        let service_presets = store.resolve_service_presets_full(&service.id)?;
        EnvResolver::resolve_runtime_env(
            &service,
            mode,
            &shell_env,
            &project_presets,
            &service_presets,
        )
    }

    pub fn list_presets(&self) -> CoreResult<Vec<EnvPreset>> {
        self.presets().list_presets()
    }

    pub fn get_preset(&self, preset_id: &str) -> CoreResult<EnvPreset> {
        self.presets().get_preset(preset_id)
    }

    pub fn create_preset(
        &self,
        name: &str,
        entries: &[PresetEntryInput],
    ) -> CoreResult<EnvPreset> {
        self.presets().create_preset(name, entries)
    }

    pub fn update_preset(
        &self,
        preset_id: &str,
        name: &str,
        entries: &[PresetEntryInput],
    ) -> CoreResult<EnvPreset> {
        self.presets().update_preset(preset_id, name, entries)
    }

    pub fn delete_preset(&self, preset_id: &str) -> CoreResult<()> {
        self.presets().delete_preset(preset_id)
    }

    pub fn attach_preset_to_project(
        &self,
        project_id: &str,
        preset_id: &str,
    ) -> CoreResult<Vec<AttachedPreset>> {
        self.presets().attach_preset_to_project(project_id, preset_id)
    }

    pub fn detach_preset_from_project(
        &self,
        project_id: &str,
        preset_id: &str,
    ) -> CoreResult<Vec<AttachedPreset>> {
        self.presets()
            .detach_preset_from_project(project_id, preset_id)
    }

    pub fn reorder_project_presets(
        &self,
        project_id: &str,
        preset_ids: &[String],
    ) -> CoreResult<Vec<AttachedPreset>> {
        self.presets()
            .reorder_project_presets(project_id, preset_ids)
    }

    pub fn attach_preset_to_service(
        &self,
        service_id: &str,
        preset_id: &str,
    ) -> CoreResult<Vec<AttachedPreset>> {
        self.presets().attach_preset_to_service(service_id, preset_id)
    }

    pub fn detach_preset_from_service(
        &self,
        service_id: &str,
        preset_id: &str,
    ) -> CoreResult<Vec<AttachedPreset>> {
        self.presets()
            .detach_preset_from_service(service_id, preset_id)
    }

    pub fn reorder_service_presets(
        &self,
        service_id: &str,
        preset_ids: &[String],
    ) -> CoreResult<Vec<AttachedPreset>> {
        self.presets()
            .reorder_service_presets(service_id, preset_ids)
    }

    pub fn inspect_project_shared_env(&self, project_id: &str) -> CoreResult<ProjectEnvSummary> {
        self.get_project(project_id)?;
        self.presets().inspect_project_shared_env(project_id)
    }

    pub async fn test_db_connection(&self, key: &str, url: &str) -> DbTestResult {
        DbConnectionTester::test_connection(key, url, DEFAULT_DB_TIMEOUT).await
    }

    pub async fn test_service_db_connection(
        &self,
        service_id: &str,
        key: &str,
        mode: Option<&str>,
        value_override: Option<&str>,
    ) -> CoreResult<DbTestResult> {
        let url = match value_override {
            Some(v) => v.to_string(),
            None => {
                let inspection = self.inspect_service_env(service_id, mode)?;
                inspection
                    .entries
                    .into_iter()
                    .find(|e| e.key == key)
                    .map(|e| e.value)
                    .ok_or_else(|| {
                        CoreError::NotFound(format!("Env key '{key}' not found in service"))
                    })?
            }
        };
        Ok(DbConnectionTester::test_connection(key, &url, DEFAULT_DB_TIMEOUT).await)
    }

    pub async fn test_project_db_connection(
        &self,
        project_id: &str,
        key: &str,
    ) -> CoreResult<DbTestResult> {
        let summary = self.inspect_project_shared_env(project_id)?;
        let url = summary
            .entries
            .into_iter()
            .find(|e| e.key == key)
            .map(|e| e.value)
            .ok_or_else(|| {
                CoreError::NotFound(format!("Shared env key '{key}' not found in project"))
            })?;
        Ok(DbConnectionTester::test_connection(key, &url, DEFAULT_DB_TIMEOUT).await)
    }

    pub fn write_service_env(
        &self,
        service_id: &str,
        target_file: &str,
        entries: &std::collections::BTreeMap<String, String>,
    ) -> CoreResult<EnvWriteResult> {
        let service = self.get_service(service_id)?;
        EnvResolver::write_env_file(&service, target_file, entries)
    }

    pub fn update_service_env_key(
        &self,
        service_id: &str,
        target_file: &str,
        key: &str,
        value: &str,
    ) -> CoreResult<EnvWriteResult> {
        let service = self.get_service(service_id)?;
        EnvResolver::update_env_key(&service, target_file, key, value)
    }

    pub fn analyze_service_storage(
        &self,
        service_id: &str,
        force_refresh: bool,
    ) -> CoreResult<ServiceStorageReport> {
        let service = self.get_service(service_id)?;
        self.storage.analyze_service(&service, force_refresh)
    }

    pub fn analyze_project_storage(
        &self,
        project_id: &str,
        force_refresh: bool,
    ) -> CoreResult<ProjectStorageSummary> {
        let project = self.get_project(project_id)?;
        self.storage.analyze_project(&project, force_refresh)
    }

    pub fn get_cached_global_storage(&self) -> CoreResult<GlobalStorageSummary> {
        let projects = self.list_projects()?;
        Ok(self.storage.cached_global_summary(&projects))
    }

    pub fn analyze_all_storage(&self, force_refresh: bool) -> CoreResult<GlobalStorageSummary> {
        let projects = self.list_projects()?;
        Ok(self.storage.analyze_all(&projects, force_refresh))
    }

    pub fn clean_service_storage(
        &self,
        service_id: &str,
        folder_name: &str,
    ) -> CoreResult<StorageCleanResult> {
        let service = self.get_service(service_id)?;
        self.storage.clean_target(&service, folder_name)
    }

    pub fn clean_project_build_caches(
        &self,
        project_id: &str,
    ) -> CoreResult<Vec<StorageCleanResult>> {
        let project = self.get_project(project_id)?;
        let mut results = Vec::new();
        for service in &project.services {
            if service.is_missing {
                continue;
            }
            let report = self.storage.analyze_service(service, true)?;
            for folder in report.cleanable_folders {
                if folder.kind == StorageEntryKind::BuildCache {
                    results.push(self.storage.clean_target(service, &folder.name)?);
                }
            }
        }
        Ok(results)
    }

    pub fn subscribe_process_events(&self, listener: ProcessEventListener) {
        self.processes.subscribe(listener);
    }

    pub fn run_service_script(&self, service_id: &str, script: &str) -> CoreResult<ProcessInfo> {
        let service = self.get_service(service_id)?;
        if service.is_missing {
            return Err(CoreError::InvalidFolder(format!(
                "Service folder does not exist: {}",
                service.path
            )));
        }
        if !service.scripts.contains_key(script) {
            return Err(CoreError::Validation(format!(
                "Script '{script}' not found in service '{}'",
                service.name
            )));
        }

        let (spec, env_map) = self.preview_service_run_spec(service_id, script)?;
        let auto_restart = service.auto_restart_scripts.iter().any(|s| s == script);

        self.processes
            .spawn_script(&service, script, &spec, &env_map, auto_restart)
    }

    pub fn stop_process(&self, process_id: &str) -> CoreResult<ProcessInfo> {
        self.processes.stop_process(process_id)
    }

    pub fn stop_process_with_grace(
        &self,
        process_id: &str,
        grace_period: Duration,
    ) -> CoreResult<ProcessInfo> {
        self.processes
            .stop_process_with_grace(process_id, grace_period)
    }

    pub fn restart_process(&self, process_id: &str) -> CoreResult<ProcessInfo> {
        let existing = self.processes.get_process(process_id)?;
        let _ = self.processes.stop_process(process_id)?;
        self.run_service_script(&existing.service_id, &existing.script)
    }

    pub fn stop_all_processes(&self) {
        self.processes.stop_all_processes();
    }

    fn resolve_service_default_script(service: &Service) -> Option<String> {
        if let Some(ref def) = service.default_script {
            if service.scripts.contains_key(def) {
                return Some(def.clone());
            }
        }
        for preferred in ["dev", "start:dev", "serve", "start"] {
            if service.scripts.contains_key(preferred) {
                return Some(preferred.to_string());
            }
        }
        service.scripts.keys().next().cloned()
    }

    pub fn compute_project_status(&self, project_id: &str) -> CoreResult<ProjectStatusSummary> {
        let project = self.get_project(project_id)?;
        let processes = self.list_processes();
        Ok(Self::aggregate_project_status(&project, &processes))
    }

    fn aggregate_project_status(
        project: &Project,
        processes: &[ProcessInfo],
    ) -> ProjectStatusSummary {
        let total_services = project.services.len();
        let mut running_services = 0usize;
        let mut crashed_services = 0usize;
        let mut starting_any = false;
        let mut stopping_any = false;

        for svc in &project.services {
            let mut svc_procs: Vec<&ProcessInfo> = processes
                .iter()
                .filter(|p| p.service_id == svc.id)
                .collect();
            svc_procs.sort_by(|a, b| b.started_at.cmp(&a.started_at));

            let has_active = svc_procs.iter().any(|p| p.status.is_active());
            if has_active {
                running_services += 1;
                if svc_procs
                    .iter()
                    .any(|p| matches!(p.status, ProcessStatus::Starting | ProcessStatus::Restarting))
                {
                    starting_any = true;
                }
                if svc_procs
                    .iter()
                    .any(|p| p.status == ProcessStatus::Stopping)
                {
                    stopping_any = true;
                }
            } else if let Some(latest) = svc_procs.first() {
                if latest.status == ProcessStatus::Crashed {
                    crashed_services += 1;
                }
            }
        }

        let status = if total_services > 0 && running_services == total_services {
            if stopping_any {
                ProjectAggregateStatus::Stopping
            } else if starting_any {
                ProjectAggregateStatus::Starting
            } else {
                ProjectAggregateStatus::AllRunning
            }
        } else if running_services > 0 {
            if stopping_any {
                ProjectAggregateStatus::Stopping
            } else {
                ProjectAggregateStatus::Partial
            }
        } else if crashed_services > 0 {
            ProjectAggregateStatus::Crashed
        } else {
            ProjectAggregateStatus::Stopped
        };

        ProjectStatusSummary {
            project_id: project.id.clone(),
            status,
            running_services,
            crashed_services,
            total_services,
        }
    }

    pub fn start_project_all(&self, project_id: &str) -> CoreResult<ProjectOrchestrationResult> {
        let project = self.get_project(project_id)?;
        let mut services = project.services.clone();
        services.sort_by_key(|s| (s.start_order, s.created_at.clone()));

        let mut steps: Vec<ProjectOrchestrationStep> = services
            .iter()
            .map(|svc| {
                let script = Self::resolve_service_default_script(svc);
                let step = ProjectOrchestrationStep {
                    project_id: project.id.clone(),
                    service_id: svc.id.clone(),
                    service_name: svc.name.clone(),
                    script,
                    order: svc.start_order,
                    state: OrchestrationStepState::Waiting,
                    process_id: None,
                    error: None,
                };
                self.processes
                    .emit_event(ProcessEvent::OrchestrationStep(step.clone()));
                step
            })
            .collect();

        let mut started_process_ids = Vec::new();
        let existing_processes = self.list_processes();

        for (idx, svc) in services.iter().enumerate() {
            let script_opt = steps[idx].script.clone();
            if svc.is_missing {
                steps[idx].state = OrchestrationStepState::Skipped;
                steps[idx].error = Some("Folder service tidak ditemukan".to_string());
                self.processes
                    .emit_event(ProcessEvent::OrchestrationStep(steps[idx].clone()));
                continue;
            }
            let Some(script) = script_opt else {
                steps[idx].state = OrchestrationStepState::Skipped;
                steps[idx].error = Some("Tidak ada script yang dapat dijalankan".to_string());
                self.processes
                    .emit_event(ProcessEvent::OrchestrationStep(steps[idx].clone()));
                continue;
            };

            if let Some(active) = existing_processes
                .iter()
                .find(|p| p.service_id == svc.id && p.script == script && p.status.is_active())
            {
                steps[idx].state = OrchestrationStepState::Running;
                steps[idx].process_id = Some(active.id.clone());
                self.processes
                    .emit_event(ProcessEvent::OrchestrationStep(steps[idx].clone()));
                continue;
            }

            steps[idx].state = OrchestrationStepState::Starting;
            self.processes
                .emit_event(ProcessEvent::OrchestrationStep(steps[idx].clone()));

            match self.run_service_script(&svc.id, &script) {
                Ok(proc_info) => {
                    steps[idx].state = OrchestrationStepState::Running;
                    steps[idx].process_id = Some(proc_info.id.clone());
                    started_process_ids.push(proc_info.id);
                    self.processes
                        .emit_event(ProcessEvent::OrchestrationStep(steps[idx].clone()));
                }
                Err(err) => {
                    steps[idx].state = OrchestrationStepState::Failed;
                    steps[idx].error = Some(err.to_string());
                    self.processes
                        .emit_event(ProcessEvent::OrchestrationStep(steps[idx].clone()));
                }
            }

            if idx + 1 < services.len() {
                std::thread::sleep(Duration::from_millis(80));
            }
        }

        let status = self.compute_project_status(project_id)?;
        Ok(ProjectOrchestrationResult {
            project_id: project.id,
            action: "start_all".to_string(),
            steps,
            started_process_ids,
            stopped_process_ids: Vec::new(),
            status,
        })
    }

    pub fn stop_project_all(&self, project_id: &str) -> CoreResult<ProjectOrchestrationResult> {
        let project = self.get_project(project_id)?;
        let mut services = project.services.clone();
        // Stop in reverse start order
        services.sort_by(|a, b| {
            b.start_order
                .cmp(&a.start_order)
                .then_with(|| b.created_at.cmp(&a.created_at))
        });

        let active_processes = self.list_processes();
        let mut steps = Vec::with_capacity(services.len());
        let mut stopped_process_ids = Vec::new();

        for svc in &services {
            let matching: Vec<ProcessInfo> = active_processes
                .iter()
                .filter(|p| p.service_id == svc.id && p.status.is_active())
                .cloned()
                .collect();

            if matching.is_empty() {
                let step = ProjectOrchestrationStep {
                    project_id: project.id.clone(),
                    service_id: svc.id.clone(),
                    service_name: svc.name.clone(),
                    script: svc.default_script.clone(),
                    order: svc.start_order,
                    state: OrchestrationStepState::Stopped,
                    process_id: None,
                    error: None,
                };
                self.processes
                    .emit_event(ProcessEvent::OrchestrationStep(step.clone()));
                steps.push(step);
                continue;
            }

            let mut step = ProjectOrchestrationStep {
                project_id: project.id.clone(),
                service_id: svc.id.clone(),
                service_name: svc.name.clone(),
                script: matching.first().map(|p| p.script.clone()),
                order: svc.start_order,
                state: OrchestrationStepState::Stopping,
                process_id: matching.first().map(|p| p.id.clone()),
                error: None,
            };
            self.processes
                .emit_event(ProcessEvent::OrchestrationStep(step.clone()));

            let mut stop_err: Option<String> = None;
            for proc in matching {
                match self.stop_process(&proc.id) {
                    Ok(_) => stopped_process_ids.push(proc.id),
                    Err(e) => stop_err = Some(e.to_string()),
                }
            }

            if let Some(err) = stop_err {
                step.state = OrchestrationStepState::Failed;
                step.error = Some(err);
            } else {
                step.state = OrchestrationStepState::Stopped;
            }
            self.processes
                .emit_event(ProcessEvent::OrchestrationStep(step.clone()));
            steps.push(step);
        }

        let status = self.compute_project_status(project_id)?;
        Ok(ProjectOrchestrationResult {
            project_id: project.id,
            action: "stop_all".to_string(),
            steps,
            started_process_ids: Vec::new(),
            stopped_process_ids,
            status,
        })
    }

    pub fn restart_project_all(&self, project_id: &str) -> CoreResult<ProjectOrchestrationResult> {
        let stop_res = self.stop_project_all(project_id)?;
        let mut start_res = self.start_project_all(project_id)?;
        start_res.action = "restart_all".to_string();
        start_res.stopped_process_ids = stop_res.stopped_process_ids;
        Ok(start_res)
    }

    pub fn list_processes(&self) -> Vec<ProcessInfo> {
        self.processes.list_processes()
    }

    pub fn get_process(&self, process_id: &str) -> CoreResult<ProcessInfo> {
        self.processes.get_process(process_id)
    }

    pub fn get_process_logs(
        &self,
        process_id: &str,
        filter: Option<&str>,
        stderr_only: bool,
    ) -> CoreResult<Vec<LogLine>> {
        self.processes
            .get_process_logs(process_id, filter, stderr_only)
    }

    pub fn get_project_logs(
        &self,
        project_id: &str,
        filter: Option<&str>,
        stderr_only: bool,
    ) -> Vec<LogLine> {
        self.processes
            .get_project_logs(project_id, filter, stderr_only)
    }

    pub fn get_all_logs(&self, filter: Option<&str>, stderr_only: bool) -> Vec<LogLine> {
        self.processes.get_all_logs(filter, stderr_only)
    }

    pub fn clear_process_logs(&self, process_id: &str) -> CoreResult<()> {
        self.processes.clear_process_logs(process_id)
    }

    pub fn clear_project_logs(&self, project_id: &str) {
        self.processes.clear_project_logs(project_id);
    }

    pub fn export_logs_to_file(
        &self,
        scope: &LogExportScope,
        path: &Path,
        filter: Option<&str>,
        stderr_only: bool,
        strip_ansi: bool,
    ) -> CoreResult<usize> {
        self.processes
            .export_logs_to_file(scope, path, filter, stderr_only, strip_ansi)
    }

    pub fn sync_proxy_routes(&self) -> CoreResult<ProxyStatus> {
        let projects = self.list_projects()?;
        let processes = self.list_processes();
        self.proxy.set_routes_from_projects(&projects, &processes);
        Ok(self.proxy.status())
    }

    pub fn get_proxy_status(&self) -> CoreResult<ProxyStatus> {
        let enabled = self
            .get_setting("proxy_enabled")?
            .map(|v| v != "false")
            .unwrap_or(true);
        self.proxy.set_enabled_flag(enabled);
        self.sync_proxy_routes()
    }

    pub fn start_proxy(&self) -> CoreResult<ProxyStatus> {
        let _ = self.sync_proxy_routes()?;
        self.proxy
            .start(DEFAULT_PROXY_PREFERRED_PORT, DEFAULT_PROXY_FALLBACK_PORT)
    }

    pub fn start_proxy_on_port(&self, port: u16) -> CoreResult<ProxyStatus> {
        let _ = self.sync_proxy_routes()?;
        self.proxy.start(port, DEFAULT_PROXY_FALLBACK_PORT)
    }

    pub fn stop_proxy(&self) -> CoreResult<ProxyStatus> {
        self.proxy.stop();
        self.sync_proxy_routes()
    }

    pub fn set_proxy_enabled(&self, enabled: bool) -> CoreResult<ProxyStatus> {
        self.set_setting("proxy_enabled", if enabled { "true" } else { "false" })?;
        self.proxy.set_enabled_flag(enabled);
        if enabled {
            self.start_proxy()
        } else {
            self.stop_proxy()
        }
    }

    pub fn preview_hosts_sync(&self) -> CoreResult<HostsSyncPreview> {
        let status = self.sync_proxy_routes()?;
        let domains: Vec<String> = status.routes.into_iter().map(|r| r.domain).collect();
        preview_hosts_sync_at(&system_hosts_path(), &domains)
    }

    pub fn sync_etc_hosts(&self) -> CoreResult<HostsSyncResult> {
        let status = self.sync_proxy_routes()?;
        let domains: Vec<String> = status.routes.into_iter().map(|r| r.domain).collect();
        sync_hosts_file_elevated(&domains)
    }

    pub fn open_external_url(&self, url: &str) -> CoreResult<()> {
        open_url_in_browser(url)
    }

    pub fn active_process_count(&self) -> usize {
        self.list_processes()
            .into_iter()
            .filter(|p| p.status.is_active())
            .count()
    }

    pub fn detach_processes_on_exit(&self) {
        self.processes.set_stop_on_drop(false);
    }

    pub fn get_service_git_info(&self, service_id: &str) -> CoreResult<GitStatusInfo> {
        let svc = self.get_service(service_id)?;
        Ok(crate::git_info::inspect_git_folder(Path::new(&svc.path)))
    }

    pub fn get_all_services_git_info(
        &self,
    ) -> CoreResult<std::collections::HashMap<String, GitStatusInfo>> {
        let projects = self.list_projects()?;
        let mut map = std::collections::HashMap::new();
        for proj in projects {
            for svc in proj.services {
                map.insert(
                    svc.id,
                    crate::git_info::inspect_git_folder(Path::new(&svc.path)),
                );
            }
        }
        Ok(map)
    }

    pub fn get_desktop_tool_settings(&self) -> CoreResult<DesktopToolSettings> {
        let path_env = self.shell_env.get_path().unwrap_or_default();
        let saved_editor = self.get_setting("default_editor")?;
        let saved_terminal = self.get_setting("default_terminal")?;
        Ok(detect_tools(&path_env, saved_editor, saved_terminal))
    }

    pub fn set_default_editor(&self, editor_id: Option<&str>) -> CoreResult<DesktopToolSettings> {
        let val = editor_id.map(str::trim).unwrap_or("");
        self.set_setting("default_editor", val)?;
        self.get_desktop_tool_settings()
    }

    pub fn set_default_terminal(
        &self,
        terminal_id: Option<&str>,
    ) -> CoreResult<DesktopToolSettings> {
        let val = terminal_id.map(str::trim).unwrap_or("");
        self.set_setting("default_terminal", val)?;
        self.get_desktop_tool_settings()
    }

    pub fn service_browser_url(&self, service_id: &str) -> CoreResult<String> {
        let svc = self.get_service(service_id)?;
        let proxy_status = self.proxy.status();
        if proxy_status.running {
            if let Some(route) = proxy_status
                .routes
                .into_iter()
                .find(|r| r.service_id == svc.id)
            {
                return Ok(route.url);
            }
            if let Some(port) = svc.port {
                let slug = service_domain_slug(&svc.name);
                let bound = proxy_status.bound_port.unwrap_or(port);
                return Ok(format_local_domain_url(&format!("{slug}.localhost"), bound));
            }
        }
        let port = svc.port.unwrap_or(3000);
        Ok(format!("http://localhost:{port}"))
    }

    pub fn open_service_quick_action(
        &self,
        service_id: &str,
        target: QuickActionTarget,
    ) -> CoreResult<()> {
        let svc = self.get_service(service_id)?;
        let folder = Path::new(&svc.path);
        let path_env = self.shell_env.get_path().unwrap_or_default();
        match target {
            QuickActionTarget::Editor => {
                let saved = self.get_setting("default_editor")?;
                open_folder_in_editor(folder, saved.as_deref(), &path_env)
            }
            QuickActionTarget::Terminal => {
                let saved = self.get_setting("default_terminal")?;
                open_folder_in_terminal(folder, saved.as_deref(), &path_env)
            }
            QuickActionTarget::FileManager => open_folder_in_file_manager(folder),
            QuickActionTarget::Browser => {
                let url = self.service_browser_url(service_id)?;
                open_url_in_browser(&url)
            }
        }
    }
}
