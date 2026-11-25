use crate::adapter::ProjectAdapter;
use crate::error::{CoreError, CoreResult};
use crate::models::{
    Framework, PackageManager, PortInjectionMethod, PortStrategy, RunCommandSpec, Service,
    ServiceDescriptor,
};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Default)]
pub struct NodeAdapter;

impl NodeAdapter {
    pub fn new() -> Self {
        Self
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
            package_manager: PackageManager::Npm,
            framework: Framework::Unknown,
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
        let args = match pm {
            PackageManager::Npm => vec!["run".to_string(), script.to_string()],
            PackageManager::Pnpm => vec!["run".to_string(), script.to_string()],
            PackageManager::Yarn => vec!["run".to_string(), script.to_string()],
            PackageManager::Bun => vec!["run".to_string(), script.to_string()],
        };
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
