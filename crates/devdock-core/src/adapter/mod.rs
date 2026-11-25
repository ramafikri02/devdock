pub mod node;

use crate::error::CoreResult;
use crate::models::{Framework, PortStrategy, RunCommandSpec, Service, ServiceDescriptor};
use std::path::Path;
use std::sync::Arc;

/// Pluggable ecosystem contract (Node.js first; extensible to Laravel, Python, Go, etc.).
pub trait ProjectAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn detect(&self, folder: &Path) -> bool;
    fn describe(&self, folder: &Path) -> CoreResult<ServiceDescriptor>;
    fn build_run_command(
        &self,
        service: &Service,
        script: &str,
        runtime_node_bin: Option<&Path>,
    ) -> CoreResult<RunCommandSpec>;
    fn env_file_conventions(&self) -> Vec<&'static str>;
    fn port_strategy(&self, framework: &Framework) -> PortStrategy;
}

pub struct AdapterRegistry {
    adapters: Vec<Arc<dyn ProjectAdapter>>,
}

impl Default for AdapterRegistry {
    fn default() -> Self {
        let mut registry = Self {
            adapters: Vec::new(),
        };
        registry.register(Arc::new(node::NodeAdapter::new()));
        registry
    }
}

impl AdapterRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, adapter: Arc<dyn ProjectAdapter>) {
        self.adapters.push(adapter);
    }

    pub fn list_ids(&self) -> Vec<String> {
        self.adapters.iter().map(|a| a.id().to_string()).collect()
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn ProjectAdapter>> {
        self.adapters.iter().find(|a| a.id() == id).cloned()
    }

    pub fn detect(&self, folder: &Path) -> Option<Arc<dyn ProjectAdapter>> {
        self.adapters.iter().find(|a| a.detect(folder)).cloned()
    }
}
