pub mod adapter;
pub mod db;
pub mod db_tester;
pub mod env_resolver;
pub mod error;
pub mod log_buffer;
pub mod models;
pub mod ports;
pub mod presets;
pub mod process_manager;
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
    AppBootstrapInfo, AttachedPreset, DbTestResult, EnvPreset, EnvWriteResult,
    GlobalStorageSummary, LogExportScope, LogLine, NodeInstallProgress, NodeInstallResult,
    PackageManager, PortCheckResult, PortInjectionMethod, PortInspectorSnapshot, PresetEntryInput,
    ProcessInfo, Project, ProjectEnvSummary, ProjectStorageSummary, ScanResult, Service,
    ServiceDescriptor, ServiceEnvInspection, ServiceNodeRuntime, ServiceStorageReport,
    StorageCleanResult,
};
use crate::ports::PortManager;
use crate::presets::PresetStore;
use crate::process_manager::{
    AutoRestartPolicy, ProcessEventListener, ProcessManager, DEFAULT_STOP_GRACE_PERIOD,
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
        })
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
}
