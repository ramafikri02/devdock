use devdock_core::shell_env::LoginShellEnvProvider;
use devdock_core::traits::{
    InMemoryNotifier, InMemorySecretStore, InMemoryShellEnvProvider, ShellEnvProvider,
};
use devdock_core::DevDockCore;
use std::fs;
use std::sync::Arc;
use tempfile::TempDir;

#[test]
fn initializes_sqlite_on_disk_and_runs_migrations() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("nested").join("devdock.sqlite");

    let core = DevDockCore::new(
        &db_path,
        Arc::new(InMemorySecretStore::new()),
        Arc::new(InMemoryShellEnvProvider::new("/usr/local/bin:/usr/bin")),
        Arc::new(InMemoryNotifier::new()),
    )
    .expect("core should initialize");

    assert!(db_path.is_file(), "SQLite database file should be created");
    assert_eq!(core.schema_version().unwrap(), 1);

    // Persisting settings works across re-opens.
    core.set_setting("theme", "light").unwrap();
    drop(core);

    let reopened = DevDockCore::new(
        &db_path,
        Arc::new(InMemorySecretStore::new()),
        Arc::new(InMemoryShellEnvProvider::new("/usr/local/bin:/usr/bin")),
        Arc::new(InMemoryNotifier::new()),
    )
    .expect("reopening existing DB should be idempotent");

    assert_eq!(reopened.schema_version().unwrap(), 1);
    assert_eq!(reopened.get_setting("theme").unwrap().as_deref(), Some("light"));
}

#[test]
fn os_seam_fakes_work_for_secrets_shell_env_and_notifications() {
    let secrets = Arc::new(InMemorySecretStore::new());
    let shell_env = Arc::new(InMemoryShellEnvProvider::new("/opt/homebrew/bin:/usr/bin"));
    let notifier = Arc::new(InMemoryNotifier::new());

    let dir = TempDir::new().unwrap();
    let core = DevDockCore::new(
        &dir.path().join("devdock.db"),
        secrets.clone(),
        shell_env.clone(),
        notifier.clone(),
    )
    .unwrap();

    // SecretStore
    assert_eq!(core.secrets().get("db_url").unwrap(), None);
    core.secrets().set("db_url", "postgres://secret").unwrap();
    assert_eq!(
        core.secrets().get("db_url").unwrap().as_deref(),
        Some("postgres://secret")
    );
    core.secrets().delete("db_url").unwrap();
    assert_eq!(core.secrets().get("db_url").unwrap(), None);

    // ShellEnvProvider get & refresh
    assert_eq!(core.shell_path().unwrap(), "/opt/homebrew/bin:/usr/bin");
    shell_env.set_path("/Users/dev/.fnm/current/bin:/opt/homebrew/bin:/usr/bin");
    let refreshed = core.refresh_shell_path().unwrap();
    assert!(refreshed.contains(".fnm"));
    assert_eq!(shell_env.refresh_count(), 1);

    // Notifier
    core.notifier()
        .notify("Process crashed", "api-server exited with code 1")
        .unwrap();
    let recorded = notifier.notifications();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].title, "Process crashed");
}

#[test]
fn real_login_shell_env_provider_resolves_non_empty_path() {
    let provider = LoginShellEnvProvider::new();
    let path = provider.get_path().expect("login shell PATH should resolve");
    assert!(!path.trim().is_empty(), "resolved PATH should not be empty");

    let refreshed = provider.refresh().expect("refreshing PATH should succeed");
    assert!(!refreshed.trim().is_empty());
}

#[test]
fn node_adapter_contract_detects_and_describes_node_folder() {
    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();
    assert!(core.list_adapters().contains(&"node".to_string()));

    let dir = TempDir::new().unwrap();
    let empty_dir = dir.path().join("empty");
    fs::create_dir_all(&empty_dir).unwrap();
    assert!(core.detect_adapter(&empty_dir).is_none());

    let node_dir = dir.path().join("sample-app");
    fs::create_dir_all(&node_dir).unwrap();
    fs::write(
        node_dir.join("package.json"),
        r#"{
            "name": "sample-app",
            "scripts": {
                "dev": "vite",
                "build": "vite build"
            }
        }"#,
    )
    .unwrap();

    let adapter = core
        .detect_adapter(&node_dir)
        .expect("NodeAdapter should detect package.json");
    assert_eq!(adapter.id(), "node");
    assert!(adapter.env_file_conventions().contains(&".env"));

    let descriptor = core.describe_folder(&node_dir).unwrap();
    assert_eq!(descriptor.name, "sample-app");
    assert_eq!(descriptor.scripts.get("dev").map(String::as_str), Some("vite"));
    assert_eq!(
        descriptor.scripts.get("build").map(String::as_str),
        Some("vite build")
    );
}
