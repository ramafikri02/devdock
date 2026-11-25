pub mod adapter;
pub mod db;
pub mod error;
pub mod models;
pub mod registry;
pub mod scanner;
pub mod shell_env;
pub mod traits;

use crate::adapter::{AdapterRegistry, ProjectAdapter};
use crate::db::Database;
use crate::error::{CoreError, CoreResult};
use crate::models::{
    AppBootstrapInfo, PackageManager, Project, ScanResult, Service, ServiceDescriptor,
};
use crate::registry::ProjectRegistry;
use crate::scanner::FolderScanner;
use crate::shell_env::LoginShellEnvProvider;
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
}
