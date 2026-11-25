use crate::adapter::AdapterRegistry;
use crate::db::Database;
use crate::error::{CoreError, CoreResult};
use crate::models::{Framework, PackageManager, PortInjectionMethod, Project, Service};
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use uuid::Uuid;

struct ServiceRow {
    id: String,
    project_id: String,
    name: String,
    path: String,
    adapter: String,
    start_order: i32,
    default_script: Option<String>,
    pm_override: Option<String>,
    port: Option<i64>,
    port_injection: Option<String>,
    node_version_override: Option<String>,
    created_at: String,
    updated_at: String,
}

struct ProjectRow {
    id: String,
    name: String,
    root_path: Option<String>,
    created_at: String,
    updated_at: String,
}

pub struct ProjectRegistry<'a> {
    db: &'a Database,
    adapters: &'a AdapterRegistry,
}

impl<'a> ProjectRegistry<'a> {
    pub fn new(db: &'a Database, adapters: &'a AdapterRegistry) -> Self {
        Self { db, adapters }
    }

    fn normalize_folder(folder: &Path) -> CoreResult<PathBuf> {
        if !folder.is_dir() {
            return Err(CoreError::InvalidFolder(format!(
                "Folder does not exist: {}",
                folder.display()
            )));
        }
        Ok(std::fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf()))
    }

    fn pick_default_script(scripts: &BTreeMap<String, String>) -> Option<String> {
        for preferred in ["dev", "start:dev", "serve", "start"] {
            if scripts.contains_key(preferred) {
                return Some(preferred.to_string());
            }
        }
        scripts.keys().next().cloned()
    }

    fn parse_port_injection(raw: Option<String>) -> Option<PortInjectionMethod> {
        match raw.as_deref() {
            Some("env") => Some(PortInjectionMethod::Env),
            Some("flag") => Some(PortInjectionMethod::Flag),
            Some("both") => Some(PortInjectionMethod::Both),
            _ => None,
        }
    }

    fn port_injection_as_str(method: &PortInjectionMethod) -> &'static str {
        match method {
            PortInjectionMethod::Env => "env",
            PortInjectionMethod::Flag => "flag",
            PortInjectionMethod::Both => "both",
        }
    }

    fn allocate_port_in_conn(
        conn: &rusqlite::Connection,
        default_port: u16,
    ) -> CoreResult<u16> {
        let mut stmt = conn.prepare("SELECT port FROM service WHERE port IS NOT NULL")?;
        let reserved: std::collections::HashSet<u16> = stmt
            .query_map([], |row| row.get::<_, i64>(0))?
            .filter_map(Result::ok)
            .filter_map(|p| u16::try_from(p).ok())
            .collect();

        let mut candidate = default_port.max(1024);
        while reserved.contains(&candidate) && candidate < 65535 {
            candidate += 1;
        }
        Ok(candidate)
    }

    fn hydrate_service(&self, row: ServiceRow) -> Service {
        let folder = PathBuf::from(&row.path);
        let pm_override = row.pm_override.as_deref().and_then(PackageManager::parse);
        let port = row.port.and_then(|p| u16::try_from(p).ok());
        let port_injection = Self::parse_port_injection(row.port_injection);

        let adapter = self
            .adapters
            .get(&row.adapter)
            .or_else(|| self.adapters.detect(&folder));

        let (detected_pm, detected_framework, scripts, is_missing) = match adapter {
            Some(adp) if folder.is_dir() && adp.detect(&folder) => match adp.describe(&folder) {
                Ok(desc) => (desc.package_manager, desc.framework, desc.scripts, false),
                Err(_) => (PackageManager::Npm, Framework::Unknown, BTreeMap::new(), true),
            },
            _ => (PackageManager::Npm, Framework::Unknown, BTreeMap::new(), true),
        };

        Service {
            id: row.id,
            project_id: row.project_id,
            name: row.name,
            path: row.path,
            adapter: row.adapter,
            start_order: row.start_order,
            default_script: row.default_script,
            pm_override,
            port,
            port_injection,
            node_version_override: row.node_version_override,
            detected_pm,
            detected_framework,
            scripts,
            is_missing,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }

    fn check_duplicate_path(&self, path_str: &str, ignore_service_id: Option<&str>) -> CoreResult<()> {
        let existing: Option<String> = self.db.with_conn(|conn| {
            let id = conn
                .query_row(
                    "SELECT id FROM service WHERE path = ?1",
                    params![path_str],
                    |row| row.get(0),
                )
                .optional()?;
            Ok(id)
        })?;

        if let Some(found_id) = existing {
            if ignore_service_id != Some(found_id.as_str()) {
                return Err(CoreError::DuplicatePath(format!(
                    "Folder is already registered: {path_str}"
                )));
            }
        }
        Ok(())
    }

    pub fn register_folder_as_project(
        &self,
        folder: &Path,
        project_name: Option<&str>,
    ) -> CoreResult<Project> {
        let normalized = Self::normalize_folder(folder)?;
        let path_str = normalized.to_string_lossy().to_string();

        self.check_duplicate_path(&path_str, None)?;

        let adapter = self.adapters.detect(&normalized).ok_or_else(|| {
            CoreError::InvalidFolder(format!(
                "No supported project found in {} (expected package.json)",
                normalized.display()
            ))
        })?;
        let desc = adapter.describe(&normalized)?;

        let display_name = project_name
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| desc.name.clone());

        let now = Utc::now().to_rfc3339();
        let project_id = Uuid::new_v4().to_string();
        let service_id = Uuid::new_v4().to_string();
        let default_script = Self::pick_default_script(&desc.scripts);

        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO project (id, name, root_path, created_at, updated_at)
                 VALUES (?1, ?2, NULL, ?3, ?4)",
                params![project_id, display_name, now, now],
            )?;
            conn.execute(
                "INSERT INTO service (
                    id, project_id, name, path, adapter, start_order, default_script,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8)",
                params![
                    service_id,
                    project_id,
                    desc.name,
                    path_str,
                    adapter.id(),
                    default_script,
                    now,
                    now
                ],
            )?;
            Ok(())
        })?;

        self.get_project(&project_id)
    }

    pub fn register_grouped_project(
        &self,
        project_name: &str,
        folders: &[PathBuf],
        root_path: Option<&Path>,
    ) -> CoreResult<Project> {
        let trimmed_name = project_name.trim();
        if trimmed_name.is_empty() {
            return Err(CoreError::Validation(
                "Project name cannot be empty".to_string(),
            ));
        }
        if folders.is_empty() {
            return Err(CoreError::Validation(
                "At least one service folder must be provided".to_string(),
            ));
        }

        let mut prepared = Vec::with_capacity(folders.len());
        let mut seen_paths = std::collections::HashSet::new();

        for folder in folders {
            let normalized = Self::normalize_folder(folder)?;
            let path_str = normalized.to_string_lossy().to_string();
            if !seen_paths.insert(path_str.clone()) {
                return Err(CoreError::DuplicatePath(format!(
                    "Duplicate folder in selection: {path_str}"
                )));
            }
            self.check_duplicate_path(&path_str, None)?;

            let adapter = self.adapters.detect(&normalized).ok_or_else(|| {
                CoreError::InvalidFolder(format!(
                    "No supported project found in {} (expected package.json)",
                    normalized.display()
                ))
            })?;
            let desc = adapter.describe(&normalized)?;
            let default_script = Self::pick_default_script(&desc.scripts);
            prepared.push((desc.name, path_str, adapter.id().to_string(), default_script));
        }

        let root_path_str = match root_path {
            Some(rp) => {
                let norm = Self::normalize_folder(rp)?;
                Some(norm.to_string_lossy().to_string())
            }
            None => None,
        };

        let now = Utc::now().to_rfc3339();
        let project_id = Uuid::new_v4().to_string();

        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO project (id, name, root_path, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![project_id, trimmed_name, root_path_str, now, now],
            )?;

            for (idx, (svc_name, path_str, adapter_id, default_script)) in
                prepared.iter().enumerate()
            {
                let service_id = Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO service (
                        id, project_id, name, path, adapter, start_order, default_script,
                        created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        service_id,
                        project_id,
                        svc_name,
                        path_str,
                        adapter_id,
                        idx as i32,
                        default_script,
                        now,
                        now
                    ],
                )?;
            }

            tx.commit()?;
            Ok(())
        })?;

        self.get_project(&project_id)
    }

    pub fn attach_folder_to_project(
        &self,
        project_id: &str,
        folder: &Path,
        service_name: Option<&str>,
    ) -> CoreResult<Service> {
        // Ensure target project exists
        self.get_project(project_id)?;

        let normalized = Self::normalize_folder(folder)?;
        let path_str = normalized.to_string_lossy().to_string();

        self.check_duplicate_path(&path_str, None)?;

        let adapter = self.adapters.detect(&normalized).ok_or_else(|| {
            CoreError::InvalidFolder(format!(
                "No supported project found in {} (expected package.json)",
                normalized.display()
            ))
        })?;
        let desc = adapter.describe(&normalized)?;

        let final_service_name = service_name
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| desc.name.clone());

        let now = Utc::now().to_rfc3339();
        let service_id = Uuid::new_v4().to_string();
        let default_script = Self::pick_default_script(&desc.scripts);

        self.db.with_conn(|conn| {
            let next_order: i32 = conn.query_row(
                "SELECT COALESCE(MAX(start_order), -1) + 1 FROM service WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )?;
            conn.execute(
                "INSERT INTO service (
                    id, project_id, name, path, adapter, start_order, default_script,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    service_id,
                    project_id,
                    final_service_name,
                    path_str,
                    adapter.id(),
                    next_order,
                    default_script,
                    now,
                    now
                ],
            )?;
            conn.execute(
                "UPDATE project SET updated_at = ?1 WHERE id = ?2",
                params![now, project_id],
            )?;
            Ok(())
        })?;

        self.get_service(&service_id)
    }

    pub fn list_projects(&self) -> CoreResult<Vec<Project>> {
        let project_rows: Vec<ProjectRow> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, root_path, created_at, updated_at
                 FROM project
                 ORDER BY created_at ASC, name ASC",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(ProjectRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        root_path: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })?;

        let service_rows: Vec<ServiceRow> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, project_id, name, path, adapter, start_order, default_script,
                        pm_override, port, port_injection, node_version_override,
                        created_at, updated_at
                 FROM service
                 ORDER BY start_order ASC, created_at ASC",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(ServiceRow {
                        id: row.get(0)?,
                        project_id: row.get(1)?,
                        name: row.get(2)?,
                        path: row.get(3)?,
                        adapter: row.get(4)?,
                        start_order: row.get(5)?,
                        default_script: row.get(6)?,
                        pm_override: row.get(7)?,
                        port: row.get(8)?,
                        port_injection: row.get(9)?,
                        node_version_override: row.get(10)?,
                        created_at: row.get(11)?,
                        updated_at: row.get(12)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })?;

        let mut services_by_project: BTreeMap<String, Vec<Service>> = BTreeMap::new();
        for s_row in service_rows {
            let hydrated = self.hydrate_service(s_row);
            services_by_project
                .entry(hydrated.project_id.clone())
                .or_default()
                .push(hydrated);
        }

        let projects = project_rows
            .into_iter()
            .map(|p| {
                let services = services_by_project.remove(&p.id).unwrap_or_default();
                Project {
                    id: p.id,
                    name: p.name,
                    root_path: p.root_path,
                    created_at: p.created_at,
                    updated_at: p.updated_at,
                    services,
                }
            })
            .collect();

        Ok(projects)
    }

    pub fn get_project(&self, project_id: &str) -> CoreResult<Project> {
        let project_row: Option<ProjectRow> = self.db.with_conn(|conn| {
            let row = conn
                .query_row(
                    "SELECT id, name, root_path, created_at, updated_at
                     FROM project WHERE id = ?1",
                    params![project_id],
                    |row| {
                        Ok(ProjectRow {
                            id: row.get(0)?,
                            name: row.get(1)?,
                            root_path: row.get(2)?,
                            created_at: row.get(3)?,
                            updated_at: row.get(4)?,
                        })
                    },
                )
                .optional()?;
            Ok(row)
        })?;

        let p = project_row
            .ok_or_else(|| CoreError::NotFound(format!("Project not found: {project_id}")))?;

        let service_rows: Vec<ServiceRow> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, project_id, name, path, adapter, start_order, default_script,
                        pm_override, port, port_injection, node_version_override,
                        created_at, updated_at
                 FROM service
                 WHERE project_id = ?1
                 ORDER BY start_order ASC, created_at ASC",
            )?;
            let rows = stmt
                .query_map(params![project_id], |row| {
                    Ok(ServiceRow {
                        id: row.get(0)?,
                        project_id: row.get(1)?,
                        name: row.get(2)?,
                        path: row.get(3)?,
                        adapter: row.get(4)?,
                        start_order: row.get(5)?,
                        default_script: row.get(6)?,
                        pm_override: row.get(7)?,
                        port: row.get(8)?,
                        port_injection: row.get(9)?,
                        node_version_override: row.get(10)?,
                        created_at: row.get(11)?,
                        updated_at: row.get(12)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })?;

        let services = service_rows
            .into_iter()
            .map(|r| self.hydrate_service(r))
            .collect();

        Ok(Project {
            id: p.id,
            name: p.name,
            root_path: p.root_path,
            created_at: p.created_at,
            updated_at: p.updated_at,
            services,
        })
    }

    pub fn get_service(&self, service_id: &str) -> CoreResult<Service> {
        let row: Option<ServiceRow> = self.db.with_conn(|conn| {
            let row = conn
                .query_row(
                    "SELECT id, project_id, name, path, adapter, start_order, default_script,
                            pm_override, port, port_injection, node_version_override,
                            created_at, updated_at
                     FROM service WHERE id = ?1",
                    params![service_id],
                    |row| {
                        Ok(ServiceRow {
                            id: row.get(0)?,
                            project_id: row.get(1)?,
                            name: row.get(2)?,
                            path: row.get(3)?,
                            adapter: row.get(4)?,
                            start_order: row.get(5)?,
                            default_script: row.get(6)?,
                            pm_override: row.get(7)?,
                            port: row.get(8)?,
                            port_injection: row.get(9)?,
                            node_version_override: row.get(10)?,
                            created_at: row.get(11)?,
                            updated_at: row.get(12)?,
                        })
                    },
                )
                .optional()?;
            Ok(row)
        })?;

        let s = row
            .ok_or_else(|| CoreError::NotFound(format!("Service not found: {service_id}")))?;
        Ok(self.hydrate_service(s))
    }

    pub fn refresh_service(&self, service_id: &str) -> CoreResult<Service> {
        self.get_service(service_id)
    }

    pub fn rename_project(&self, project_id: &str, new_name: &str) -> CoreResult<Project> {
        let trimmed = new_name.trim();
        if trimmed.is_empty() {
            return Err(CoreError::Validation(
                "Project name cannot be empty".to_string(),
            ));
        }

        let now = Utc::now().to_rfc3339();
        let affected = self.db.with_conn(|conn| {
            let count = conn.execute(
                "UPDATE project SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![trimmed, now, project_id],
            )?;
            Ok(count)
        })?;

        if affected == 0 {
            return Err(CoreError::NotFound(format!(
                "Project not found: {project_id}"
            )));
        }

        self.get_project(project_id)
    }

    pub fn rename_service(&self, service_id: &str, new_name: &str) -> CoreResult<Service> {
        let trimmed = new_name.trim();
        if trimmed.is_empty() {
            return Err(CoreError::Validation(
                "Service name cannot be empty".to_string(),
            ));
        }

        let now = Utc::now().to_rfc3339();
        let affected = self.db.with_conn(|conn| {
            let count = conn.execute(
                "UPDATE service SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![trimmed, now, service_id],
            )?;
            Ok(count)
        })?;

        if affected == 0 {
            return Err(CoreError::NotFound(format!(
                "Service not found: {service_id}"
            )));
        }

        self.get_service(service_id)
    }

    pub fn set_service_pm_override(
        &self,
        service_id: &str,
        pm_override: Option<PackageManager>,
    ) -> CoreResult<Service> {
        let now = Utc::now().to_rfc3339();
        let pm_str = pm_override.as_ref().map(PackageManager::as_str);

        let affected = self.db.with_conn(|conn| {
            let count = conn.execute(
                "UPDATE service SET pm_override = ?1, updated_at = ?2 WHERE id = ?3",
                params![pm_str, now, service_id],
            )?;
            Ok(count)
        })?;

        if affected == 0 {
            return Err(CoreError::NotFound(format!(
                "Service not found: {service_id}"
            )));
        }

        self.get_service(service_id)
    }

    pub fn set_service_port(&self, service_id: &str, port: Option<u16>) -> CoreResult<Service> {
        let now = Utc::now().to_rfc3339();
        let port_i64 = port.map(|p| p as i64);

        let affected = self.db.with_conn(|conn| {
            let count = conn.execute(
                "UPDATE service SET port = ?1, updated_at = ?2 WHERE id = ?3",
                params![port_i64, now, service_id],
            )?;
            Ok(count)
        })?;

        if affected == 0 {
            return Err(CoreError::NotFound(format!(
                "Service not found: {service_id}"
            )));
        }

        self.get_service(service_id)
    }

    pub fn set_service_port_injection(
        &self,
        service_id: &str,
        method: Option<PortInjectionMethod>,
    ) -> CoreResult<Service> {
        let now = Utc::now().to_rfc3339();
        let method_str = method.as_ref().map(Self::port_injection_as_str);

        let affected = self.db.with_conn(|conn| {
            let count = conn.execute(
                "UPDATE service SET port_injection = ?1, updated_at = ?2 WHERE id = ?3",
                params![method_str, now, service_id],
            )?;
            Ok(count)
        })?;

        if affected == 0 {
            return Err(CoreError::NotFound(format!(
                "Service not found: {service_id}"
            )));
        }

        self.get_service(service_id)
    }

    pub fn ensure_service_port(&self, service_id: &str) -> CoreResult<u16> {
        let svc = self.get_service(service_id)?;
        if let Some(port) = svc.port {
            return Ok(port);
        }
        let default_port = self
            .adapters
            .get(&svc.adapter)
            .map(|a| a.port_strategy(&svc.detected_framework).default_port)
            .unwrap_or(3000);
        let allocated = self
            .db
            .with_conn(|conn| Self::allocate_port_in_conn(conn, default_port))?;
        self.set_service_port(service_id, Some(allocated))?;
        Ok(allocated)
    }

    pub fn set_service_node_version_override(
        &self,
        service_id: &str,
        version: Option<&str>,
    ) -> CoreResult<Service> {
        let now = Utc::now().to_rfc3339();
        let cleaned = version
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string);

        let affected = self.db.with_conn(|conn| {
            let count = conn.execute(
                "UPDATE service SET node_version_override = ?1, updated_at = ?2 WHERE id = ?3",
                params![cleaned, now, service_id],
            )?;
            Ok(count)
        })?;

        if affected == 0 {
            return Err(CoreError::NotFound(format!(
                "Service not found: {service_id}"
            )));
        }

        self.get_service(service_id)
    }

    pub fn relocate_service(&self, service_id: &str, new_folder: &Path) -> CoreResult<Service> {
        // Ensure service exists
        self.get_service(service_id)?;

        let normalized = Self::normalize_folder(new_folder)?;
        let path_str = normalized.to_string_lossy().to_string();

        self.check_duplicate_path(&path_str, Some(service_id))?;

        let adapter = self.adapters.detect(&normalized).ok_or_else(|| {
            CoreError::InvalidFolder(format!(
                "No supported project found in {} (expected package.json)",
                normalized.display()
            ))
        })?;

        let now = Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE service SET path = ?1, adapter = ?2, updated_at = ?3 WHERE id = ?4",
                params![path_str, adapter.id(), now, service_id],
            )?;
            Ok(())
        })?;

        self.get_service(service_id)
    }

    pub fn remove_service(&self, service_id: &str) -> CoreResult<()> {
        self.db.with_conn(|conn| {
            let project_id: Option<String> = conn
                .query_row(
                    "SELECT project_id FROM service WHERE id = ?1",
                    params![service_id],
                    |row| row.get(0),
                )
                .optional()?;

            let Some(project_id) = project_id else {
                return Err(CoreError::NotFound(format!(
                    "Service not found: {service_id}"
                )));
            };

            conn.execute("DELETE FROM service WHERE id = ?1", params![service_id])?;

            let remaining: i64 = conn.query_row(
                "SELECT COUNT(*) FROM service WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )?;

            if remaining == 0 {
                conn.execute("DELETE FROM project WHERE id = ?1", params![project_id])?;
            }

            Ok(())
        })
    }

    pub fn remove_project(&self, project_id: &str) -> CoreResult<()> {
        let affected = self.db.with_conn(|conn| {
            let count = conn.execute("DELETE FROM project WHERE id = ?1", params![project_id])?;
            Ok(count)
        })?;

        if affected == 0 {
            return Err(CoreError::NotFound(format!(
                "Project not found: {project_id}"
            )));
        }

        Ok(())
    }
}
