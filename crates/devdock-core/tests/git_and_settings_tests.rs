use devdock_core::git_info::inspect_git_folder;
use devdock_core::traits::{InMemoryNotifier, InMemorySecretStore, InMemoryShellEnvProvider};
use devdock_core::DevDockCore;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use tempfile::TempDir;

fn run_git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(["-C"])
        .arg(dir)
        .args(args)
        .output()
        .expect("run git");
    assert!(
        out.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn git_info_detects_branch_and_dirty_state_and_handles_non_git_dirs() {
    let temp = TempDir::new().expect("tempdir");

    // Non-git folder
    let plain_dir = temp.path().join("plain-folder");
    fs::create_dir_all(&plain_dir).unwrap();
    let plain_info = inspect_git_folder(&plain_dir);
    assert!(!plain_info.is_git_repo);
    assert_eq!(plain_info.branch, None);
    assert!(!plain_info.is_dirty);

    // Real git repo
    let repo_dir = temp.path().join("web-app");
    fs::create_dir_all(&repo_dir).unwrap();
    fs::write(
        repo_dir.join("package.json"),
        r#"{"name":"web-app","version":"1.0.0","scripts":{"dev":"node -v"}}"#,
    )
    .unwrap();

    run_git(&repo_dir, &["init", "-b", "feature/tray"]);
    run_git(&repo_dir, &["config", "user.email", "dev@devdock.local"]);
    run_git(&repo_dir, &["config", "user.name", "DevDock Test"]);
    run_git(&repo_dir, &["add", "."]);
    run_git(&repo_dir, &["commit", "-m", "init"]);

    let core = DevDockCore::in_memory_for_tests("/usr/bin:/bin").expect("core");
    let proj = core.register_folder_as_project(&repo_dir, None).unwrap();
    let svc_id = &proj.services[0].id;

    let clean = core.get_service_git_info(svc_id).expect("git info clean");
    assert!(clean.is_git_repo);
    assert_eq!(clean.branch.as_deref(), Some("feature/tray"));
    assert!(!clean.is_dirty);
    assert_eq!(clean.changed_files, 0);

    // Modify file -> dirty
    fs::write(repo_dir.join("dirty.txt"), "uncommitted").unwrap();
    let dirty = core.get_service_git_info(svc_id).expect("git info dirty");
    assert!(dirty.is_git_repo);
    assert_eq!(dirty.branch.as_deref(), Some("feature/tray"));
    assert!(dirty.is_dirty);
    assert_eq!(dirty.changed_files, 1);

    let all_map = core.get_all_services_git_info().expect("all git map");
    assert_eq!(all_map[svc_id].is_dirty, true);
}

#[test]
fn desktop_tool_settings_and_theme_persist_across_sqlite_reopen() {
    let temp = TempDir::new().expect("tempdir");
    let db_path = temp.path().join("devdock.sqlite");

    {
        let core = DevDockCore::new(
            &db_path,
            Arc::new(InMemorySecretStore::new()),
            Arc::new(InMemoryShellEnvProvider::new("/usr/bin:/bin")),
            Arc::new(InMemoryNotifier::new()),
        )
        .expect("open core 1");
        core.set_setting("theme", "light").unwrap();
        let updated = core.set_default_editor(Some("cursor")).unwrap();
        assert_eq!(updated.default_editor.as_deref(), Some("cursor"));
        let updated_term = core.set_default_terminal(Some("ghostty")).unwrap();
        assert_eq!(updated_term.default_terminal.as_deref(), Some("ghostty"));
    }

    {
        let core = DevDockCore::new(
            &db_path,
            Arc::new(InMemorySecretStore::new()),
            Arc::new(InMemoryShellEnvProvider::new("/usr/bin:/bin")),
            Arc::new(InMemoryNotifier::new()),
        )
        .expect("open core 2");
        assert_eq!(core.get_setting("theme").unwrap().as_deref(), Some("light"));
        let tools = core.get_desktop_tool_settings().unwrap();
        assert_eq!(tools.default_editor.as_deref(), Some("cursor"));
        assert_eq!(tools.default_terminal.as_deref(), Some("ghostty"));
        assert!(!tools.detected_editors.is_empty());
        assert!(!tools.detected_terminals.is_empty());
    }
}
