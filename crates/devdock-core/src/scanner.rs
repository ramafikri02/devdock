use crate::adapter::AdapterRegistry;
use crate::db::Database;
use crate::error::{CoreError, CoreResult};
use crate::models::{ScanCandidate, ScanCandidateKind, ScanResult, ScanWorkspacePackage};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub const DEFAULT_SCAN_DEPTH: usize = 3;

const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    ".next",
    ".nuxt",
    ".output",
    ".svelte-kit",
    ".turbo",
    ".cache",
    "build",
    "out",
    "coverage",
    "target",
    ".vercel",
    ".netlify",
    ".idea",
    ".vscode",
    "vendor",
    "__pycache__",
];

pub struct FolderScanner<'a> {
    db: &'a Database,
    adapters: &'a AdapterRegistry,
}

impl<'a> FolderScanner<'a> {
    pub fn new(db: &'a Database, adapters: &'a AdapterRegistry) -> Self {
        Self { db, adapters }
    }

    fn load_registered_paths(&self) -> CoreResult<HashSet<PathBuf>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT path FROM service")?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            let set = rows
                .into_iter()
                .map(|raw| {
                    let p = PathBuf::from(&raw);
                    std::fs::canonicalize(&p).unwrap_or(p)
                })
                .collect();
            Ok(set)
        })
    }

    fn is_ignored_dir(name: &str) -> bool {
        IGNORED_DIRS.contains(&name)
    }

    pub fn scan(&self, root: &Path, max_depth: Option<usize>) -> CoreResult<ScanResult> {
        if !root.is_dir() {
            return Err(CoreError::InvalidFolder(format!(
                "Scan root does not exist or is not a directory: {}",
                root.display()
            )));
        }

        let depth_limit = max_depth.unwrap_or(DEFAULT_SCAN_DEPTH).min(10);
        let root_canon = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        let registered_paths = self.load_registered_paths()?;

        let mut candidates = Vec::new();
        let mut scanned_dirs = 0usize;

        self.walk_dir(
            &root_canon,
            0,
            depth_limit,
            &registered_paths,
            &mut scanned_dirs,
            &mut candidates,
        );

        candidates.sort_by(|a, b| a.path.cmp(&b.path));

        Ok(ScanResult {
            root_path: root_canon.to_string_lossy().to_string(),
            max_depth: depth_limit,
            scanned_dirs,
            candidates,
        })
    }

    fn walk_dir(
        &self,
        dir: &Path,
        depth: usize,
        max_depth: usize,
        registered_paths: &HashSet<PathBuf>,
        scanned_dirs: &mut usize,
        candidates: &mut Vec<ScanCandidate>,
    ) {
        *scanned_dirs += 1;

        if let Some(adapter) = self.adapters.detect(dir) {
            if let Ok(desc) = adapter.describe(dir) {
                let dir_canon = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
                if !desc.workspace_packages.is_empty() {
                    let mut ws_packages = Vec::new();
                    for pkg_path_str in &desc.workspace_packages {
                        let pkg_path = PathBuf::from(pkg_path_str);
                        let pkg_canon = std::fs::canonicalize(&pkg_path).unwrap_or(pkg_path);
                        if let Some(pkg_adapter) = self.adapters.detect(&pkg_canon) {
                            if let Ok(pkg_desc) = pkg_adapter.describe(&pkg_canon) {
                                let already_registered = registered_paths.contains(&pkg_canon);
                                ws_packages.push(ScanWorkspacePackage {
                                    name: pkg_desc.name,
                                    path: pkg_canon.to_string_lossy().to_string(),
                                    package_manager: pkg_desc.package_manager,
                                    framework: pkg_desc.framework,
                                    script_count: pkg_desc.scripts.len(),
                                    already_registered,
                                });
                            }
                        }
                    }

                    if !ws_packages.is_empty() {
                        ws_packages.sort_by(|a, b| a.path.cmp(&b.path));
                        let all_registered = ws_packages.iter().all(|p| p.already_registered);
                        candidates.push(ScanCandidate {
                            kind: ScanCandidateKind::Monorepo,
                            name: desc.name,
                            path: dir_canon.to_string_lossy().to_string(),
                            adapter: desc.adapter,
                            package_manager: desc.package_manager,
                            framework: desc.framework,
                            script_count: desc.scripts.len(),
                            already_registered: all_registered,
                            workspace_packages: ws_packages,
                        });
                        // Stop descending into monorepo since its workspace packages are already listed
                        return;
                    }
                }

                candidates.push(ScanCandidate {
                    kind: ScanCandidateKind::Service,
                    name: desc.name,
                    path: dir_canon.to_string_lossy().to_string(),
                    adapter: desc.adapter,
                    package_manager: desc.package_manager,
                    framework: desc.framework,
                    script_count: desc.scripts.len(),
                    already_registered: registered_paths.contains(&dir_canon),
                    workspace_packages: Vec::new(),
                });
                // Stop descending once a standalone codebase root is detected
                return;
            }
        }

        if depth >= max_depth {
            return;
        }

        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };

        let mut subdirs: Vec<PathBuf> = entries
            .flatten()
            .filter_map(|entry| {
                let file_type = entry.file_type().ok()?;
                if !file_type.is_dir() || file_type.is_symlink() {
                    return None;
                }
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if Self::is_ignored_dir(&name_str) {
                    return None;
                }
                Some(entry.path())
            })
            .collect();

        subdirs.sort();

        for sub in subdirs {
            self.walk_dir(
                &sub,
                depth + 1,
                max_depth,
                registered_paths,
                scanned_dirs,
                candidates,
            );
        }
    }
}
