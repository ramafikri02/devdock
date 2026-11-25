# Contributing to DevDock

Thank you for helping improve DevDock!

## Architecture Overview

DevDock separates all business logic into an independent Rust core library (`crates/devdock-core`) with zero dependency on Tauri:

- **`crates/devdock-core`**: Pure Rust domain modules (`ProjectRegistry`, `FolderScanner`, `ProjectAdapter`, `EnvResolver`, `PresetStore`, `DbConnectionTester`, `RuntimeResolver`, `PortManager`, `ProcessManager`, `ResourceMonitor`, `StorageAnalyzer`, `LocalDomainProxy`, `ExportImportManager`).
- **`src-tauri`**: Thin Tauri v2 desktop wrapper translating UI commands/events to `DevDockCore` and managing OS tray/window lifecycle.
- **`src/`**: React + TypeScript + Tailwind v4 + Zustand UI.

## Adding a New `ProjectAdapter` (e.g. Laravel, Python, Go)

All ecosystem support lives behind the `ProjectAdapter` trait in `crates/devdock-core/src/adapter/mod.rs`:

```rust
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
```

Steps to add an ecosystem adapter:
1. Create a module under `crates/devdock-core/src/adapter/<ecosystem>.rs` implementing `ProjectAdapter`.
2. Register your adapter inside `AdapterRegistry::default()` in `crates/devdock-core/src/adapter/mod.rs`.
3. Add integration tests under `crates/devdock-core/tests/` using temporary fixture directories.
4. No UI or SQLite schema changes are required — `Service` stores `adapter: String` generically.

## Adding a New `VersionManager` (e.g. `nvm`, `volta`, `mise`)

Runtime version managers implement `VersionManager` in `crates/devdock-core/src/runtime.rs`:

```rust
pub trait VersionManager: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn is_available(&self, path_env: &str) -> bool;
    fn list_installed(&self, path_env: &str) -> CoreResult<Vec<String>>;
    fn resolve_bin_dir(
        &self,
        version: &str,
        path_env: &str,
        cwd: &Path,
    ) -> CoreResult<Option<PathBuf>>;
    fn install_version(
        &self,
        version: &str,
        path_env: &str,
        on_line: &mut dyn FnMut(String),
    ) -> CoreResult<String>;
}
```

Steps to add a version manager:
1. Implement `VersionManager` in `crates/devdock-core/src/runtime.rs`.
2. Register it in `RuntimeResolver::new()` in priority order.
3. Add tests using an executable shim script in a temporary `PATH` directory (see `crates/devdock-core/tests/runtime_tests.rs`).

## Testing Guidelines

- Test external behavior through `DevDockCore`'s public API rather than internal module details.
- Use `DevDockCore::in_memory_for_tests(...)` and in-memory fakes (`InMemorySecretStore`, `InMemoryShellEnvProvider`, `InMemoryNotifier`) for deterministic tests.
- Run before opening a PR:
  ```bash
  cargo test --workspace
  pnpm typecheck
  pnpm build
  pnpm test:e2e
  ```
