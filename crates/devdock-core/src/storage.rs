use crate::error::{CoreError, CoreResult};
use crate::models::{
    CleanableFolder, GlobalStorageSummary, Project, ProjectStorageSummary, Service,
    ServiceStorageReport, StorageCleanResult, StorageEntryKind,
};
use chrono::Utc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const BUILD_CACHE_DIRS: &[&str] = &[
    ".next",
    "dist",
    ".nuxt",
    ".output",
    ".svelte-kit",
    ".turbo",
    ".cache",
    "build",
    "out",
    ".parcel-cache",
    ".vite",
    ".astro",
    "coverage",
];

#[derive(Default)]
pub struct StorageAnalyzer {
    cache: Mutex<HashMap<String, ServiceStorageReport>>,
}

impl StorageAnalyzer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_allowed_cleanup_target(folder_name: &str) -> Option<StorageEntryKind> {
        let trimmed = folder_name.trim();
        if trimmed.is_empty()
            || trimmed.contains('/')
            || trimmed.contains('\\')
            || trimmed.contains("..")
        {
            return None;
        }
        if trimmed == "node_modules" {
            return Some(StorageEntryKind::NodeModules);
        }
        if BUILD_CACHE_DIRS.contains(&trimmed) {
            return Some(StorageEntryKind::BuildCache);
        }
        None
    }

    fn dir_size_bytes(root: &Path) -> u64 {
        let mut total = 0u64;
        let mut stack = vec![root.to_path_buf()];

        while let Some(current) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&current) else {
                continue;
            };
            for entry in entries.flatten() {
                let Ok(meta) = entry.metadata() else {
                    continue;
                };
                // Skip symlinks to prevent escaping the folder or infinite loops
                if meta.file_type().is_symlink() {
                    continue;
                }
                if meta.is_file() {
                    total = total.saturating_add(meta.len());
                } else if meta.is_dir() {
                    stack.push(entry.path());
                }
            }
        }

        total
    }

    fn compute_service_storage(service: &Service) -> CoreResult<ServiceStorageReport> {
        let root = PathBuf::from(&service.path);
        if !root.is_dir() {
            return Err(CoreError::InvalidFolder(format!(
                "Service folder does not exist: {}",
                root.display()
            )));
        }

        let mut node_modules_bytes = 0u64;
        let mut build_cache_bytes = 0u64;
        let mut source_bytes = 0u64;
        let mut cleanable_folders = Vec::new();

        let entries = std::fs::read_dir(&root)?;
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            let path = entry.path();
            if meta.is_file() {
                source_bytes = source_bytes.saturating_add(meta.len());
            } else if meta.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                let size = Self::dir_size_bytes(&path);
                match Self::is_allowed_cleanup_target(&name) {
                    Some(StorageEntryKind::NodeModules) => {
                        node_modules_bytes = node_modules_bytes.saturating_add(size);
                        cleanable_folders.push(CleanableFolder {
                            name,
                            path: path.to_string_lossy().to_string(),
                            kind: StorageEntryKind::NodeModules,
                            size_bytes: size,
                        });
                    }
                    Some(StorageEntryKind::BuildCache) => {
                        build_cache_bytes = build_cache_bytes.saturating_add(size);
                        cleanable_folders.push(CleanableFolder {
                            name,
                            path: path.to_string_lossy().to_string(),
                            kind: StorageEntryKind::BuildCache,
                            size_bytes: size,
                        });
                    }
                    None => {
                        source_bytes = source_bytes.saturating_add(size);
                    }
                }
            }
        }

        cleanable_folders.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes).then(a.name.cmp(&b.name)));

        let reclaimable_bytes = node_modules_bytes.saturating_add(build_cache_bytes);
        let total_bytes = reclaimable_bytes.saturating_add(source_bytes);

        Ok(ServiceStorageReport {
            service_id: service.id.clone(),
            service_name: service.name.clone(),
            total_bytes,
            node_modules_bytes,
            build_cache_bytes,
            source_bytes,
            reclaimable_bytes,
            cleanable_folders,
            calculated_at: Utc::now().to_rfc3339(),
            from_cache: false,
        })
    }

    pub fn analyze_service(
        &self,
        service: &Service,
        force_refresh: bool,
    ) -> CoreResult<ServiceStorageReport> {
        if !force_refresh {
            let guard = self.cache.lock().expect("storage cache lock poisoned");
            if let Some(cached) = guard.get(&service.id) {
                let mut hit = cached.clone();
                hit.service_name = service.name.clone();
                hit.from_cache = true;
                return Ok(hit);
            }
        }

        let report = Self::compute_service_storage(service)?;
        {
            let mut guard = self.cache.lock().expect("storage cache lock poisoned");
            guard.insert(service.id.clone(), report.clone());
        }
        Ok(report)
    }

    pub fn analyze_project(
        &self,
        project: &Project,
        force_refresh: bool,
    ) -> CoreResult<ProjectStorageSummary> {
        let mut reports = Vec::with_capacity(project.services.len());
        let mut total_bytes = 0u64;
        let mut node_modules_bytes = 0u64;
        let mut build_cache_bytes = 0u64;
        let mut source_bytes = 0u64;
        let mut reclaimable_bytes = 0u64;

        for svc in &project.services {
            if svc.is_missing {
                continue;
            }
            if let Ok(rep) = self.analyze_service(svc, force_refresh) {
                total_bytes = total_bytes.saturating_add(rep.total_bytes);
                node_modules_bytes = node_modules_bytes.saturating_add(rep.node_modules_bytes);
                build_cache_bytes = build_cache_bytes.saturating_add(rep.build_cache_bytes);
                source_bytes = source_bytes.saturating_add(rep.source_bytes);
                reclaimable_bytes = reclaimable_bytes.saturating_add(rep.reclaimable_bytes);
                reports.push(rep);
            }
        }

        Ok(ProjectStorageSummary {
            project_id: project.id.clone(),
            project_name: project.name.clone(),
            total_bytes,
            node_modules_bytes,
            build_cache_bytes,
            source_bytes,
            reclaimable_bytes,
            services: reports,
        })
    }

    pub fn cached_global_summary(&self, projects: &[Project]) -> GlobalStorageSummary {
        let guard = self.cache.lock().expect("storage cache lock poisoned");
        let mut total_bytes = 0u64;
        let mut node_modules_bytes = 0u64;
        let mut build_cache_bytes = 0u64;
        let mut reclaimable_bytes = 0u64;
        let mut service_count = 0usize;
        let mut cached_service_count = 0usize;

        for p in projects {
            for svc in &p.services {
                service_count += 1;
                if let Some(rep) = guard.get(&svc.id) {
                    cached_service_count += 1;
                    total_bytes = total_bytes.saturating_add(rep.total_bytes);
                    node_modules_bytes = node_modules_bytes.saturating_add(rep.node_modules_bytes);
                    build_cache_bytes = build_cache_bytes.saturating_add(rep.build_cache_bytes);
                    reclaimable_bytes = reclaimable_bytes.saturating_add(rep.reclaimable_bytes);
                }
            }
        }

        GlobalStorageSummary {
            total_bytes,
            node_modules_bytes,
            build_cache_bytes,
            reclaimable_bytes,
            service_count,
            cached_service_count,
        }
    }

    pub fn analyze_all(
        &self,
        projects: &[Project],
        force_refresh: bool,
    ) -> GlobalStorageSummary {
        for p in projects {
            for svc in &p.services {
                if !svc.is_missing {
                    let _ = self.analyze_service(svc, force_refresh);
                }
            }
        }
        self.cached_global_summary(projects)
    }

    pub fn clean_target(
        &self,
        service: &Service,
        folder_name: &str,
    ) -> CoreResult<StorageCleanResult> {
        if Self::is_allowed_cleanup_target(folder_name).is_none() {
            return Err(CoreError::Validation(format!(
                "Folder '{folder_name}' is not an allowed cleanup target"
            )));
        }

        let service_root = PathBuf::from(&service.path);
        if !service_root.is_dir() {
            return Err(CoreError::InvalidFolder(format!(
                "Service folder does not exist: {}",
                service_root.display()
            )));
        }

        let target_path = service_root.join(folder_name.trim());
        let meta = std::fs::symlink_metadata(&target_path).map_err(|_| {
            CoreError::NotFound(format!(
                "Cleanup target does not exist: {}",
                target_path.display()
            ))
        })?;

        if meta.file_type().is_symlink() || !meta.is_dir() {
            return Err(CoreError::Validation(format!(
                "Refusing to delete non-directory or symlink target: {folder_name}"
            )));
        }

        // Verify canonical path stays inside service_root
        let canon_root = std::fs::canonicalize(&service_root)?;
        let canon_target = std::fs::canonicalize(&target_path)?;
        if !canon_target.starts_with(&canon_root) || canon_target == canon_root {
            return Err(CoreError::Validation(
                "Cleanup target escapes service directory".to_string(),
            ));
        }

        let freed_bytes = Self::dir_size_bytes(&canon_target);
        std::fs::remove_dir_all(&canon_target)?;

        let updated_report = self.analyze_service(service, true)?;

        Ok(StorageCleanResult {
            service_id: service.id.clone(),
            deleted_folder: folder_name.trim().to_string(),
            freed_bytes,
            updated_report,
        })
    }

    pub fn invalidate_service(&self, service_id: &str) {
        let mut guard = self.cache.lock().expect("storage cache lock poisoned");
        guard.remove(service_id);
    }
}
