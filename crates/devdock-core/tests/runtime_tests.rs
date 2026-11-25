use devdock_core::models::{NodeRuntimeStatus, NodeVersionSource, ProcessStatus};
use devdock_core::DevDockCore;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tempfile::TempDir;

#[cfg(unix)]
fn make_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(path).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms).unwrap();
}

#[cfg(unix)]
fn write_script(path: &Path, content: &str) {
    fs::write(path, content).unwrap();
    make_executable(path);
}

#[cfg(unix)]
fn create_fake_fnm_env(
    root: &Path,
    initial_versions: &[&str],
) -> (PathBuf, PathBuf) {
    let bin_dir = root.join("fake-bin");
    let versions_dir = root.join("fnm-versions");
    fs::create_dir_all(&bin_dir).unwrap();
    fs::create_dir_all(&versions_dir).unwrap();

    let installed_file = root.join("installed.txt");
    let mut list_content = String::new();
    for ver in initial_versions {
        let normalized = if ver.starts_with('v') {
            ver.to_string()
        } else {
            format!("v{ver}")
        };
        list_content.push_str(&format!("{normalized}\n"));
        let node_bin_dir = versions_dir.join(&normalized).join("bin");
        fs::create_dir_all(&node_bin_dir).unwrap();
        let node_script = format!(
            "#!/bin/sh\nif [ \"$1\" = \"-v\" ]; then\n  echo \"{normalized}\"\n  exit 0\nfi\nif [ \"$1\" = \"-p\" ]; then\n  echo \"{}/node\"\n  exit 0\nfi\necho \"FAKE_NODE_VERSION={normalized}\"\n",
            node_bin_dir.display()
        );
        write_script(&node_bin_dir.join("node"), &node_script);
    }
    fs::write(&installed_file, list_content).unwrap();

    // Fake npm that runs `node` from PATH when executing scripts
    let npm_script = r#"#!/bin/sh
if [ "$1" = "run" ] && [ "$2" = "check-node" ]; then
  node -v
  exit 0
fi
echo "unknown script $*" >&2
exit 1
"#;
    write_script(&bin_dir.join("npm"), npm_script);

    // Default system node (v24.0.0) in fake-bin
    let sys_node = r#"#!/bin/sh
if [ "$1" = "-v" ]; then
  echo "v24.0.0"
  exit 0
fi
if [ "$1" = "-p" ]; then
  echo "$0"
  exit 0
fi
echo "SYSTEM_NODE"
"#;
    write_script(&bin_dir.join("node"), sys_node);

    // Fake fnm supporting `list`, `exec --using <ver> -- <cmd...>`, and `install <ver>`
    let fnm_script = format!(
        r#"#!/bin/sh
INSTALLED_FILE="{installed}"
VERSIONS_DIR="{versions}"

case "$1" in
  list)
    while IFS= read -r line; do
      [ -n "$line" ] && echo "* $line"
    done < "$INSTALLED_FILE"
    echo "* system"
    exit 0
    ;;
  exec)
    shift
    USING=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --using)
          USING="$2"
          shift 2
          ;;
        --using=*)
          USING="${{1#--using=}}"
          shift
          ;;
        --)
          shift
          break
          ;;
        *)
          shift
          ;;
      esac
    done
    case "$USING" in
      v*) VER="$USING" ;;
      *) VER="v$USING" ;;
    esac
    if [ -d "$VERSIONS_DIR/$VER/bin" ]; then
      PATH="$VERSIONS_DIR/$VER/bin:$PATH" "$@"
      exit $?
    fi
    echo "error: Can't find version $USING" >&2
    exit 1
    ;;
  install)
    VER="$2"
    case "$VER" in
      v*) NORM="$VER" ;;
      *) NORM="v$VER" ;;
    esac
    echo "Installing Node $NORM..."
    mkdir -p "$VERSIONS_DIR/$NORM/bin"
    cat > "$VERSIONS_DIR/$NORM/bin/node" <<EOF
#!/bin/sh
if [ "\$1" = "-v" ]; then
  echo "$NORM"
  exit 0
fi
if [ "\$1" = "-p" ]; then
  echo "$VERSIONS_DIR/$NORM/bin/node"
  exit 0
fi
echo "FAKE_NODE_VERSION=$NORM"
EOF
    chmod +x "$VERSIONS_DIR/$NORM/bin/node"
    echo "$NORM" >> "$INSTALLED_FILE"
    echo "Installed Node $NORM"
    exit 0
    ;;
  *)
    echo "unsupported fnm command: $*" >&2
    exit 1
    ;;
esac
"#,
        installed = installed_file.display(),
        versions = versions_dir.display()
    );
    write_script(&bin_dir.join("fnm"), &fnm_script);

    (bin_dir, versions_dir)
}

fn wait_until_exited(core: &DevDockCore, process_id: &str, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(info) = core.get_process(process_id) {
            if !info.status.is_active() {
                return;
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("Timed out waiting for process {process_id} to exit");
}

#[cfg(unix)]
#[test]
fn resolves_node_version_priority_nvmrc_node_version_engines_and_override() {
    let tmp = TempDir::new().unwrap();
    let (fake_bin, _) = create_fake_fnm_env(tmp.path(), &["20.11.1", "18.19.0", "22.12.0"]);
    let path_env = format!("{}:/usr/bin:/bin", fake_bin.display());
    let core = DevDockCore::in_memory_for_tests(&path_env).unwrap();

    let svc_dir = tmp.path().join("web-app");
    fs::create_dir_all(&svc_dir).unwrap();
    fs::write(
        svc_dir.join("package.json"),
        r#"{
            "name": "web-app",
            "engines": { "node": ">=18.0.0 <19.0.0" },
            "scripts": { "check-node": "node -v" }
        }"#,
    )
    .unwrap();

    let project = core.register_folder_as_project(&svc_dir, None).unwrap();
    let svc_id = &project.services[0].id;

    // 1. Only engines.node exists
    let rt = core.inspect_service_node_runtime(svc_id).unwrap();
    assert_eq!(rt.required_version.as_deref(), Some(">=18.0.0 <19.0.0"));
    assert_eq!(rt.source, NodeVersionSource::EnginesNode);
    assert_eq!(rt.matched_installed_version.as_deref(), Some("v18.19.0"));
    assert_eq!(rt.status, NodeRuntimeStatus::Matched);

    // 2. Add .node-version -> beats engines.node
    fs::write(svc_dir.join(".node-version"), "20.11.1\n").unwrap();
    let rt = core.inspect_service_node_runtime(svc_id).unwrap();
    assert_eq!(rt.required_version.as_deref(), Some("20.11.1"));
    assert_eq!(rt.source, NodeVersionSource::NodeVersionFile);
    assert_eq!(rt.matched_installed_version.as_deref(), Some("v20.11.1"));

    // 3. Add .nvmrc -> beats .node-version
    fs::write(svc_dir.join(".nvmrc"), "22\n").unwrap();
    let rt = core.inspect_service_node_runtime(svc_id).unwrap();
    assert_eq!(rt.required_version.as_deref(), Some("22"));
    assert_eq!(rt.source, NodeVersionSource::Nvmrc);
    assert_eq!(rt.matched_installed_version.as_deref(), Some("v22.12.0"));

    // 4. Set manual override -> beats .nvmrc, while detected_version still reports .nvmrc
    core.set_service_node_version_override(svc_id, Some("18"))
        .unwrap();
    let rt = core.inspect_service_node_runtime(svc_id).unwrap();
    assert_eq!(rt.required_version.as_deref(), Some("18"));
    assert_eq!(rt.source, NodeVersionSource::ManualOverride);
    assert_eq!(rt.detected_version.as_deref(), Some("22"));
    assert_eq!(rt.detected_source, NodeVersionSource::Nvmrc);
    assert_eq!(rt.matched_installed_version.as_deref(), Some("v18.19.0"));

    // 5. Clear override -> falls back to .nvmrc
    core.set_service_node_version_override(svc_id, None).unwrap();
    let rt = core.inspect_service_node_runtime(svc_id).unwrap();
    assert_eq!(rt.source, NodeVersionSource::Nvmrc);
    assert_eq!(rt.required_version.as_deref(), Some("22"));
}

#[cfg(unix)]
#[test]
fn injects_fnm_node_binary_into_script_execution_env() {
    let tmp = TempDir::new().unwrap();
    let (fake_bin, _) = create_fake_fnm_env(tmp.path(), &["20.11.1"]);
    let path_env = format!("{}:/usr/bin:/bin", fake_bin.display());
    let core = DevDockCore::in_memory_for_tests(&path_env).unwrap();

    let svc_dir = tmp.path().join("api-svc");
    fs::create_dir_all(&svc_dir).unwrap();
    fs::write(
        svc_dir.join("package.json"),
        r#"{"name": "api-svc", "scripts": { "check-node": "node -v" }}"#,
    )
    .unwrap();
    fs::write(svc_dir.join(".nvmrc"), "20.11.1\n").unwrap();

    let project = core.register_folder_as_project(&svc_dir, None).unwrap();
    let svc_id = &project.services[0].id;

    let proc = core.run_service_script(svc_id, "check-node").unwrap();
    wait_until_exited(&core, &proc.id, Duration::from_secs(5));

    let final_info = core.get_process(&proc.id).unwrap();
    assert_eq!(final_info.status, ProcessStatus::Stopped);
    assert_eq!(final_info.exit_code, Some(0));

    let logs = core.get_process_logs(&proc.id, None, false).unwrap();
    let combined: String = logs.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n");
    assert!(
        combined.contains("v20.11.1"),
        "Expected script to run under fnm Node v20.11.1, got logs: {combined}"
    );
}

#[cfg(unix)]
#[test]
fn missing_fnm_version_prompts_install_and_streams_progress() {
    let tmp = TempDir::new().unwrap();
    let (fake_bin, _) = create_fake_fnm_env(tmp.path(), &["18.19.0"]);
    let path_env = format!("{}:/usr/bin:/bin", fake_bin.display());
    let core = DevDockCore::in_memory_for_tests(&path_env).unwrap();

    let svc_dir = tmp.path().join("legacy-svc");
    fs::create_dir_all(&svc_dir).unwrap();
    fs::write(
        svc_dir.join("package.json"),
        r#"{"name": "legacy-svc", "scripts": { "check-node": "node -v" }}"#,
    )
    .unwrap();
    fs::write(svc_dir.join(".nvmrc"), "20.15.0\n").unwrap();

    let project = core.register_folder_as_project(&svc_dir, None).unwrap();
    let svc_id = &project.services[0].id;

    let rt = core.inspect_service_node_runtime(svc_id).unwrap();
    assert_eq!(rt.status, NodeRuntimeStatus::MissingInManager);
    assert!(rt.can_install);
    assert_eq!(rt.install_target.as_deref(), Some("20.15.0"));
    assert!(rt.warning.is_some());

    // Install via fnm and capture streamed progress
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_cb = Arc::clone(&events);
    let result = core
        .install_node_version(
            "20.15.0",
            Some(Arc::new(move |prog| {
                events_cb.lock().unwrap().push(prog);
            })),
        )
        .unwrap();

    assert_eq!(result.version, "20.15.0");
    assert_eq!(result.manager, "fnm");
    let recorded = events.lock().unwrap();
    assert!(recorded.len() >= 2);
    assert!(recorded.last().unwrap().done);
    assert_eq!(recorded.last().unwrap().ok, Some(true));

    // Re-inspecting should now match
    let rt_after = core.inspect_service_node_runtime(svc_id).unwrap();
    assert_eq!(rt_after.status, NodeRuntimeStatus::Matched);
    assert_eq!(rt_after.matched_installed_version.as_deref(), Some("v20.15.0"));
    assert!(!rt_after.can_install);
}

#[cfg(unix)]
#[test]
fn warns_when_no_version_manager_and_active_node_mismatches() {
    let tmp = TempDir::new().unwrap();
    let bin_dir = tmp.path().join("only-node-bin");
    fs::create_dir_all(&bin_dir).unwrap();

    // Only `node` v24.0.0 is in PATH, no `fnm`
    write_script(
        &bin_dir.join("node"),
        "#!/bin/sh\nif [ \"$1\" = \"-v\" ]; then echo \"v24.0.0\"; fi\n",
    );

    let core = DevDockCore::in_memory_for_tests(&bin_dir.display().to_string()).unwrap();

    let svc_dir = tmp.path().join("mismatch-svc");
    fs::create_dir_all(&svc_dir).unwrap();
    fs::write(
        svc_dir.join("package.json"),
        r#"{"name": "mismatch-svc", "scripts": { "dev": "echo ok" }}"#,
    )
    .unwrap();
    fs::write(svc_dir.join(".nvmrc"), "18\n").unwrap();

    let project = core.register_folder_as_project(&svc_dir, None).unwrap();
    let svc_id = &project.services[0].id;

    let rt = core.inspect_service_node_runtime(svc_id).unwrap();
    assert_eq!(rt.version_manager, None);
    assert_eq!(rt.active_node_version.as_deref(), Some("v24.0.0"));
    assert_eq!(rt.status, NodeRuntimeStatus::MismatchNoManager);
    assert!(!rt.can_install);
    assert!(rt.warning.as_deref().unwrap_or("").contains("18"));

    // If requirement matches active node (v24), no warning
    fs::write(svc_dir.join(".nvmrc"), "24\n").unwrap();
    let rt_ok = core.inspect_service_node_runtime(svc_id).unwrap();
    assert_eq!(rt_ok.status, NodeRuntimeStatus::Matched);
    assert!(rt_ok.warning.is_none());
}
