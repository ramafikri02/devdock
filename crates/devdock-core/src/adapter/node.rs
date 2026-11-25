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

        Ok(ServiceDescriptor {
            adapter: self.id().to_string(),
            name,
            package_manager,
            framework,
            scripts,
            workspace_packages: Vec::new(),
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
