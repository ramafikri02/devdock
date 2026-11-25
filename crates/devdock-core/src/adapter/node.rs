use crate::adapter::ProjectAdapter;
use crate::error::{CoreError, CoreResult};
use crate::models::{
    Framework, PackageManager, PortInjectionMethod, PortStrategy, RunCommandSpec, Service,
    ServiceDescriptor,
};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::path::Path;

#[derive(Debug, Default)]
pub struct NodeAdapter;

impl NodeAdapter {
    pub fn new() -> Self {
        Self
    }

    fn detect_package_manager(folder: &Path, pkg_json: &Value) -> PackageManager {
        // 1. Check `packageManager` field in package.json (e.g. "pnpm@9.15.0")
        if let Some(pm_field) = pkg_json.get("packageManager").and_then(|v| v.as_str()) {
            let name = pm_field.split('@').next().unwrap_or(pm_field);
            if let Some(pm) = PackageManager::parse(name) {
                return pm;
            }
        }

        // 2. Check lockfiles in folder (and up to 2 ancestors for workspace setups)
        let mut cursor = Some(folder);
        for _ in 0..3 {
            let Some(dir) = cursor else { break };
            if dir.join("pnpm-lock.yaml").is_file() {
                return PackageManager::Pnpm;
            }
            if dir.join("yarn.lock").is_file() {
                return PackageManager::Yarn;
            }
            if dir.join("bun.lockb").is_file() || dir.join("bun.lock").is_file() {
                return PackageManager::Bun;
            }
            if dir.join("package-lock.json").is_file() || dir.join("npm-shrinkwrap.json").is_file() {
                return PackageManager::Npm;
            }
            cursor = dir.parent();
        }

        PackageManager::Npm
    }

    fn detect_framework(pkg_json: &Value) -> Framework {
        let mut deps: HashSet<&str> = HashSet::new();
        for section in ["dependencies", "devDependencies", "peerDependencies"] {
            if let Some(obj) = pkg_json.get(section).and_then(|v| v.as_object()) {
                for key in obj.keys() {
                    deps.insert(key.as_str());
                }
            }
        }

        if deps.contains("next") {
            return Framework::NextJs;
        }
        if deps.contains("nuxt") || deps.contains("nuxt3") {
            return Framework::Nuxt;
        }
        if deps.contains("astro") {
            return Framework::Astro;
        }
        if deps.contains("@sveltejs/kit") {
            return Framework::SvelteKit;
        }
        if deps.contains("@remix-run/node")
            || deps.contains("@remix-run/react")
            || deps.contains("remix")
        {
            return Framework::Remix;
        }
        if deps.contains("@nestjs/core") {
            return Framework::NestJs;
        }
        if deps.contains("fastify") {
            return Framework::Fastify;
        }
        if deps.contains("hono") {
            return Framework::Hono;
        }
        if deps.contains("express") {
            return Framework::Express;
        }
        if deps.contains("vite") {
            return Framework::Vite;
        }

        Framework::Unknown
    }

    fn parse_pnpm_workspace_patterns(folder: &Path) -> Vec<String> {
        let yaml_path = folder.join("pnpm-workspace.yaml");
        let Ok(content) = std::fs::read_to_string(&yaml_path) else {
            return Vec::new();
        };

        let mut patterns = Vec::new();
        let mut in_packages = false;

        for raw_line in content.lines() {
            let line = raw_line.split('#').next().unwrap_or("").trim_end();
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if !raw_line.starts_with(' ') && !raw_line.starts_with('\t') {
                if let Some(rest) = trimmed.strip_prefix("packages:") {
                    in_packages = true;
                    let inline = rest.trim();
                    if inline.starts_with('[') && inline.ends_with(']') {
                        let inner = &inline[1..inline.len() - 1];
                        for item in inner.split(',') {
                            let cleaned = item.trim().trim_matches(|c| c == '\'' || c == '"');
                            if !cleaned.is_empty() {
                                patterns.push(cleaned.to_string());
                            }
                        }
                        in_packages = false;
                    }
                } else {
                    in_packages = false;
                }
                continue;
            }

            if in_packages {
                if let Some(item) = trimmed.strip_prefix('-') {
                    let cleaned = item.trim().trim_matches(|c| c == '\'' || c == '"');
                    if !cleaned.is_empty() {
                        patterns.push(cleaned.to_string());
                    }
                }
            }
        }

        patterns
    }

    fn parse_pkg_json_workspace_patterns(pkg_json: &Value) -> Vec<String> {
        let mut patterns = Vec::new();
        if let Some(ws) = pkg_json.get("workspaces") {
            if let Some(arr) = ws.as_array() {
                for item in arr {
                    if let Some(s) = item.as_str() {
                        patterns.push(s.to_string());
                    }
                }
            } else if let Some(arr) = ws.get("packages").and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(s) = item.as_str() {
                        patterns.push(s.to_string());
                    }
                }
            }
        }
        patterns
    }

    fn expand_workspace_pattern(root: &Path, pattern: &str) -> Vec<std::path::PathBuf> {
        let cleaned = pattern.trim().trim_start_matches("./").trim_end_matches('/');
        if cleaned.is_empty() {
            return Vec::new();
        }

        let mut results = Vec::new();
        if let Some(prefix) = cleaned.strip_suffix("/**") {
            let base = if prefix.is_empty() {
                root.to_path_buf()
            } else {
                root.join(prefix)
            };
            Self::collect_nested_packages(&base, 0, 4, &mut results);
        } else if let Some(prefix) = cleaned.strip_suffix("/*") {
            let base = if prefix.is_empty() {
                root.to_path_buf()
            } else {
                root.join(prefix)
            };
            if let Ok(entries) = std::fs::read_dir(&base) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() && path.join("package.json").is_file() {
                        results.push(path);
                    }
                }
            }
        } else if cleaned == "*" {
            if let Ok(entries) = std::fs::read_dir(root) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = entry.file_name();
                    if name == "node_modules" || name == ".git" {
                        continue;
                    }
                    if path.is_dir() && path.join("package.json").is_file() {
                        results.push(path);
                    }
                }
            }
        } else {
            let candidate = root.join(cleaned);
            if candidate.is_dir() && candidate.join("package.json").is_file() {
                results.push(candidate);
            }
        }

        results
    }

    fn collect_nested_packages(
        dir: &Path,
        depth: usize,
        max_depth: usize,
        out: &mut Vec<std::path::PathBuf>,
    ) {
        if depth > max_depth || !dir.is_dir() {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str == "node_modules"
                || name_str == ".git"
                || name_str == "dist"
                || name_str == ".next"
                || name_str == "build"
            {
                continue;
            }
            if path.join("package.json").is_file() {
                out.push(path);
            } else {
                Self::collect_nested_packages(&path, depth + 1, max_depth, out);
            }
        }
    }

    fn detect_workspace_packages(folder: &Path, pkg_json: &Value) -> Vec<String> {
        let mut patterns = Self::parse_pnpm_workspace_patterns(folder);
        if patterns.is_empty() {
            patterns = Self::parse_pkg_json_workspace_patterns(pkg_json);
        }
        if patterns.is_empty() {
            return Vec::new();
        }

        let mut included = std::collections::BTreeSet::new();
        let mut excluded = HashSet::new();

        for pat in patterns {
            let trimmed = pat.trim();
            if let Some(neg) = trimmed.strip_prefix('!') {
                for p in Self::expand_workspace_pattern(folder, neg) {
                    let canon = std::fs::canonicalize(&p).unwrap_or(p);
                    excluded.insert(canon);
                }
            } else {
                for p in Self::expand_workspace_pattern(folder, trimmed) {
                    let canon = std::fs::canonicalize(&p).unwrap_or(p);
                    included.insert(canon);
                }
            }
        }

        let root_canon = std::fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
        included
            .into_iter()
            .filter(|p| p != &root_canon && !excluded.contains(p))
            .map(|p| p.to_string_lossy().to_string())
            .collect()
    }
}

impl ProjectAdapter for NodeAdapter {
    fn id(&self) -> &'static str {
        "node"
    }

    fn detect(&self, folder: &Path) -> bool {
        folder.join("package.json").is_file()
    }

    fn describe(&self, folder: &Path) -> CoreResult<ServiceDescriptor> {
        let pkg_path = folder.join("package.json");
        if !pkg_path.is_file() {
            return Err(CoreError::InvalidFolder(format!(
                "No package.json found in {}",
                folder.display()
            )));
        }

        let raw = std::fs::read_to_string(&pkg_path)?;
        let json: Value = serde_json::from_str(&raw)?;

        let fallback_name = folder
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("node-service")
            .to_string();

        let name = json
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(ToString::to_string)
            .unwrap_or(fallback_name);

        let package_manager = Self::detect_package_manager(folder, &json);
        let framework = Self::detect_framework(&json);

        let mut scripts = BTreeMap::new();
        if let Some(obj) = json.get("scripts").and_then(|v| v.as_object()) {
            for (k, v) in obj {
                if let Some(cmd) = v.as_str() {
                    scripts.insert(k.clone(), cmd.to_string());
                }
            }
        }

        let workspace_packages = Self::detect_workspace_packages(folder, &json);

        Ok(ServiceDescriptor {
            adapter: self.id().to_string(),
            name,
            package_manager,
            framework,
            scripts,
            workspace_packages,
        })
    }

    fn build_run_command(
        &self,
        service: &Service,
        script: &str,
        _runtime_node_bin: Option<&Path>,
    ) -> CoreResult<RunCommandSpec> {
        let pm = service
            .pm_override
            .as_ref()
            .unwrap_or(&service.detected_pm);
        let program = pm.as_str().to_string();
        let args = vec!["run".to_string(), script.to_string()];
        Ok(RunCommandSpec {
            program,
            args,
            cwd: service.path.clone(),
        })
    }

    fn env_file_conventions(&self) -> Vec<&'static str> {
        vec![
            ".env",
            ".env.local",
            ".env.development",
            ".env.development.local",
            ".env.production",
            ".env.production.local",
        ]
    }

    fn port_strategy(&self, framework: &Framework) -> PortStrategy {
        match framework {
            Framework::Vite | Framework::Astro | Framework::SvelteKit => PortStrategy {
                default_port: 5173,
                method: PortInjectionMethod::Flag,
                flag_name: Some("--port".to_string()),
            },
            Framework::NextJs | Framework::Nuxt | Framework::Remix => PortStrategy {
                default_port: 3000,
                method: PortInjectionMethod::Both,
                flag_name: Some("--port".to_string()),
            },
            _ => PortStrategy {
                default_port: 3000,
                method: PortInjectionMethod::Env,
                flag_name: None,
            },
        }
    }
}
