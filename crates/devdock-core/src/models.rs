use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Npm,
    Pnpm,
    Yarn,
    Bun,
}

impl PackageManager {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Npm => "npm",
            Self::Pnpm => "pnpm",
            Self::Yarn => "yarn",
            Self::Bun => "bun",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "npm" => Some(Self::Npm),
            "pnpm" => Some(Self::Pnpm),
            "yarn" => Some(Self::Yarn),
            "bun" => Some(Self::Bun),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Framework {
    NextJs,
    Vite,
    Nuxt,
    Astro,
    SvelteKit,
    Remix,
    NestJs,
    Express,
    Fastify,
    Hono,
    Unknown,
}

impl Framework {
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::NextJs => "Next.js",
            Self::Vite => "Vite",
            Self::Nuxt => "Nuxt",
            Self::Astro => "Astro",
            Self::SvelteKit => "SvelteKit",
            Self::Remix => "Remix",
            Self::NestJs => "NestJS",
            Self::Express => "Express",
            Self::Fastify => "Fastify",
            Self::Hono => "Hono",
            Self::Unknown => "Node.js",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PortInjectionMethod {
    Env,
    Flag,
    Both,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortStrategy {
    pub default_port: u16,
    pub method: PortInjectionMethod,
    pub flag_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceDescriptor {
    pub adapter: String,
    pub name: String,
    pub package_manager: PackageManager,
    pub framework: Framework,
    pub scripts: BTreeMap<String, String>,
    pub workspace_packages: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub services: Vec<Service>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub path: String,
    pub adapter: String,
    pub start_order: i32,
    pub default_script: Option<String>,
    pub pm_override: Option<PackageManager>,
    pub port: Option<u16>,
    pub port_injection: Option<PortInjectionMethod>,
    pub node_version_override: Option<String>,
    pub detected_pm: PackageManager,
    pub detected_framework: Framework,
    pub scripts: BTreeMap<String, String>,
    pub is_missing: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBootstrapInfo {
    pub version: String,
    pub schema_version: i32,
    pub db_path: String,
    pub shell_path: String,
    pub theme: String,
    pub adapters: Vec<String>,
}
