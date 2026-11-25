pub mod adapter;
pub mod db;
pub mod env_resolver;
pub mod error;
pub mod models;
pub mod presets;
pub mod registry;
pub mod scanner;
pub mod secret_store;
pub mod shell_env;
pub mod storage;
pub mod traits;

use crate::adapter::{AdapterRegistry, ProjectAdapter};
use crate::db::Database;
use crate::env_resolver::EnvResolver;
use crate::error::{CoreError, CoreResult};
use crate::models::{
    AppBootstrapInfo, AttachedPreset, EnvPreset, EnvWriteResult, GlobalStorageSummary,
    PackageManager, PresetEntryInput, Project, ProjectEnvSummary, ProjectStorageSummary,
    ScanResult, Service, ServiceDescriptor, ServiceEnvInspection, ServiceStorageReport,
    StorageCleanResult,
};
use crate::presets::PresetStore;
use crate::registry::ProjectRegistry;
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

pub struct DevDockCore {
    db: Database,
    secrets: Arc<dyn SecretStore>,
    shell_env: Arc<dyn ShellEnvProvider>,
    notifier: Arc<dyn Notifier>,
    adapters: AdapterRegistry,
    storage: StorageAnalyzer,
}

impl DevDockCore {
    pub fn new(
        db_path: &Path,
        secrets: Arc<dyn SecretStore>,
        shell_env: Arc<dyn ShellEnvProvider>,
        notifier: Arc<dyn Notifier>,
    ) -> CoreResult<Self> {
        let db = Database::open(db_path)?;
        Ok(Self {
            db,
            secrets,
            shell_env,
            notifier,
            adapters: AdapterRegistry::default(),
            storage: StorageAnalyzer::new(),
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
        Ok(Self {
            db,
            secrets: Arc::new(InMemorySecretStore::new()),
            shell_env: Arc::new(InMemoryShellEnvProvider::new(initial_path)),
            notifier: Arc::new(InMemoryNotifier::new()),
            adapters: AdapterRegistry::default(),
            storage: StorageAnalyzer::new(),
        })
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
}
