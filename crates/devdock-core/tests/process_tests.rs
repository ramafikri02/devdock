use devdock_core::models::{
    LogExportScope, LogStream, PresetEntryInput, ProcessInfo, ProcessStatus,
};
use devdock_core::DevDockCore;
use std::fs;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};
use tempfile::TempDir;

fn host_path() -> String {
    std::env::var("PATH").unwrap_or_else(|_| "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin".into())
}

fn write_service_fixture(dir: &Path, name: &str, scripts_json: &str) {
    fs::create_dir_all(dir).expect("create fixture dir");
    let pkg = format!(
        r#"{{
  "name": "{name}",
  "version": "1.0.0",
  "scripts": {scripts_json}
}}"#
    );
    fs::write(dir.join("package.json"), pkg).expect("write package.json");
    fs::write(dir.join("package-lock.json"), "{}").expect("write lockfile");
}

fn wait_until_finished(core: &DevDockCore, process_id: &str, timeout: Duration) -> ProcessInfo {
    let deadline = Instant::now() + timeout;
    loop {
        let info = core.get_process(process_id).expect("get_process");
        if !info.status.is_active() {
            return info;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for process {process_id} to finish (status={:?})",
            info.status
        );
        thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn run_script_injects_layered_env_captures_ansi_and_filters_stderr() {
    let temp = TempDir::new().expect("tempdir");
    let svc_dir = temp.path().join("api-svc");

    write_service_fixture(
        &svc_dir,
        "api-svc",
        r#"{
    "check-env": "node -e \"console.log('SHARED=' + process.env.SHARED_KEY); console.log('PORT=' + process.env.PORT); console.log('\\x1b[32mANSI_READY_OK\\x1b[0m'); console.error('ERR_WARN_LINE');\""
  }"#,
    );
    fs::write(svc_dir.join(".env"), "SHARED_KEY=from_dotenv\nPORT=3000\n").expect("write .env");

    let core = DevDockCore::in_memory_for_tests(&host_path()).expect("core");
    let project = core
        .register_folder_as_project(&svc_dir, Some("EnvApp"))
        .expect("register");
    let svc = &project.services[0];

    let proj_preset = core
        .create_preset(
            "Project Base",
            &[PresetEntryInput {
                key: "SHARED_KEY".into(),
                value: "from_project_preset".into(),
                is_secret: false,
            }],
        )
        .expect("create project preset");
    core.attach_preset_to_project(&project.id, &proj_preset.id)
        .expect("attach project preset");

    let svc_preset = core
        .create_preset(
            "Service Override",
            &[PresetEntryInput {
                key: "SHARED_KEY".into(),
                value: "from_service_preset".into(),
                is_secret: false,
            }],
        )
        .expect("create service preset");
    core.attach_preset_to_service(&svc.id, &svc_preset.id)
        .expect("attach service preset");

    core.set_service_port(&svc.id, Some(4567))
        .expect("set port");

    let proc = core
        .run_service_script(&svc.id, "check-env")
        .expect("run script");
    let finished = wait_until_finished(&core, &proc.id, Duration::from_secs(10));

    assert_eq!(finished.status, ProcessStatus::Stopped);
    assert_eq!(finished.exit_code, Some(0));
    assert!(finished.duration_ms.is_some());

    let all_logs = core
        .get_process_logs(&proc.id, None, false)
        .expect("get logs");
    let joined_stdout: String = all_logs
        .iter()
        .filter(|l| l.stream == LogStream::Stdout)
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        joined_stdout.contains("SHARED=from_service_preset"),
        "expected service preset to override .env and project preset, got:\n{joined_stdout}"
    );
    assert!(
        joined_stdout.contains("PORT=4567"),
        "expected DevDock assigned PORT to win, got:\n{joined_stdout}"
    );

    // Search should match plain text inside ANSI escape sequences
    let ansi_match = core
        .get_process_logs(&proc.id, Some("ansi_ready_ok"), false)
        .expect("filter ansi");
    assert!(
        ansi_match
            .iter()
            .any(|l| l.text.contains("\x1b[32mANSI_READY_OK\x1b[0m")),
        "expected ANSI-colored output line to match plain-text filter, got: {ansi_match:?}"
    );

    // Stderr-only filter should return only stderr lines
    let stderr_logs = core
        .get_process_logs(&proc.id, None, true)
        .expect("stderr logs");
    assert!(
        stderr_logs
            .iter()
            .any(|l| l.stream == LogStream::Stderr && l.text.contains("ERR_WARN_LINE")),
        "expected ERR_WARN_LINE in stderr"
    );
    assert!(stderr_logs.iter().all(|l| l.stream == LogStream::Stderr));
}

#[test]
fn multiple_scripts_run_concurrently_and_merge_in_project_logs() {
    let temp = TempDir::new().expect("tempdir");
    let svc_dir = temp.path().join("multi-script-svc");

    write_service_fixture(
        &svc_dir,
        "multi-script-svc",
        r#"{
    "worker-a": "node -e \"console.log('A_BOOT'); setInterval(() => {}, 1000);\"",
    "worker-b": "node -e \"console.log('B_BOOT'); setInterval(() => {}, 1000);\""
  }"#,
    );

    let core = DevDockCore::in_memory_for_tests(&host_path()).expect("core");
    let project = core
        .register_folder_as_project(&svc_dir, Some("MultiScript"))
        .expect("register");
    let svc = &project.services[0];

    let p1 = core.run_service_script(&svc.id, "worker-a").expect("run a");
    let p2 = core.run_service_script(&svc.id, "worker-b").expect("run b");

    assert_ne!(p1.id, p2.id);
    assert_eq!(p1.status, ProcessStatus::Running);
    assert_eq!(p2.status, ProcessStatus::Running);

    // Wait briefly for both boot lines to appear in project-scoped combined logs
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let combined = core.get_project_logs(&project.id, None, false);
        let has_a = combined.iter().any(|l| l.text.contains("A_BOOT"));
        let has_b = combined.iter().any(|l| l.text.contains("B_BOOT"));
        if has_a && has_b {
            // Verify chronological monotonic ordering
            for pair in combined.windows(2) {
                assert!(pair[0].seq < pair[1].seq);
            }
            break;
        }
        assert!(Instant::now() < deadline, "timed out waiting for concurrent logs");
        thread::sleep(Duration::from_millis(30));
    }

    let stopped1 = core.stop_process(&p1.id).expect("stop p1");
    let stopped2 = core.stop_process(&p2.id).expect("stop p2");
    assert_eq!(stopped1.status, ProcessStatus::Stopped);
    assert_eq!(stopped2.status, ProcessStatus::Stopped);
}

#[cfg(unix)]
#[test]
fn stop_process_terminates_full_process_tree_with_sigkill_escalation() {
    let temp = TempDir::new().expect("tempdir");
    let svc_dir = temp.path().join("tree-svc");
    let child_pid_file = temp.path().join("grandchild.pid");

    // Script ignores SIGTERM and spawns a grandchild node process that also ignores SIGTERM
    let script_js = format!(
        r#"
const fs = require('fs');
const {{ spawn }} = require('child_process');
process.on('SIGTERM', () => {{ console.log('IGNORED_SIGTERM'); }});
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {{}}); setInterval(() => {{}}, 1000);"], {{ stdio: 'ignore' }});
fs.writeFileSync({:?}, String(child.pid));
console.log('TREE_READY');
setInterval(() => {{}}, 1000);
"#,
        child_pid_file.to_string_lossy().to_string()
    );
    fs::create_dir_all(&svc_dir).expect("dir");
    fs::write(svc_dir.join("runner.js"), script_js).expect("write runner.js");
    write_service_fixture(&svc_dir, "tree-svc", r#"{ "dev": "node runner.js" }"#);

    // Use a fast 300ms grace period to verify SIGTERM -> SIGKILL escalation deterministically
    let core = DevDockCore::in_memory_for_tests_with_limits(
        &host_path(),
        1_000,
        Duration::from_millis(300),
    )
    .expect("core");
    let project = core
        .register_folder_as_project(&svc_dir, Some("TreeApp"))
        .expect("register");
    let svc = &project.services[0];

    let proc = core.run_service_script(&svc.id, "dev").expect("run dev");

    // Wait until grandchild PID is written
    let deadline = Instant::now() + Duration::from_secs(8);
    let grandchild_pid: i32 = loop {
        if let Ok(raw) = fs::read_to_string(&child_pid_file) {
            if let Ok(pid) = raw.trim().parse::<i32>() {
                break pid;
            }
        }
        assert!(Instant::now() < deadline, "timed out waiting for grandchild pid");
        thread::sleep(Duration::from_millis(25));
    };

    // Confirm grandchild is alive before stop
    assert_eq!(
        unsafe { libc::kill(grandchild_pid, 0) },
        0,
        "grandchild should be alive before stop"
    );

    let stopped = core.stop_process(&proc.id).expect("stop tree");
    assert_eq!(stopped.status, ProcessStatus::Stopped);

    // Give OS a brief moment to reap the SIGKILLed grandchild
    let reap_deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if unsafe { libc::kill(grandchild_pid, 0) } != 0 {
            break;
        }
        assert!(
            Instant::now() < reap_deadline,
            "orphan grandchild process {grandchild_pid} remained alive after stop!"
        );
        thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn crashed_script_reports_exit_code_and_restart_spawns_fresh_instance() {
    let temp = TempDir::new().expect("tempdir");
    let svc_dir = temp.path().join("crash-svc");

    write_service_fixture(
        &svc_dir,
        "crash-svc",
        r#"{
    "fail": "node -e \"console.error('BOOM'); process.exit(42);\"",
    "stay": "node -e \"console.log('ALIVE'); setInterval(() => {}, 1000);\""
  }"#,
    );

    let core = DevDockCore::in_memory_for_tests(&host_path()).expect("core");
    let project = core
        .register_folder_as_project(&svc_dir, Some("CrashApp"))
        .expect("register");
    let svc = &project.services[0];

    let failed = core.run_service_script(&svc.id, "fail").expect("run fail");
    let finished = wait_until_finished(&core, &failed.id, Duration::from_secs(8));
    assert_eq!(finished.status, ProcessStatus::Crashed);
    assert_eq!(finished.exit_code, Some(42));
    assert!(finished.duration_ms.is_some());

    let running = core.run_service_script(&svc.id, "stay").expect("run stay");
    let restarted = core.restart_process(&running.id).expect("restart");
    assert_ne!(running.id, restarted.id);
    assert_eq!(restarted.status, ProcessStatus::Running);

    let old_after = core.get_process(&running.id).expect("old proc");
    assert_eq!(old_after.status, ProcessStatus::Stopped);

    core.stop_process(&restarted.id).expect("stop restarted");
}

#[test]
fn ring_buffer_caps_lines_clears_and_exports_to_file() {
    let temp = TempDir::new().expect("tempdir");
    let svc_dir = temp.path().join("log-svc");

    write_service_fixture(
        &svc_dir,
        "log-svc",
        r#"{
    "spam": "node -e \"for (let i = 1; i <= 120; i++) console.log('\\x1b[36mline-' + i + '\\x1b[0m');\""
  }"#,
    );

    let core = DevDockCore::in_memory_for_tests_with_limits(
        &host_path(),
        50,
        Duration::from_secs(2),
    )
    .expect("core");
    let project = core
        .register_folder_as_project(&svc_dir, Some("LogApp"))
        .expect("register");
    let svc = &project.services[0];

    let proc = core.run_service_script(&svc.id, "spam").expect("run spam");
    let finished = wait_until_finished(&core, &proc.id, Duration::from_secs(10));
    assert_eq!(finished.status, ProcessStatus::Stopped);

    let logs = core.get_process_logs(&proc.id, None, false).expect("logs");
    assert_eq!(logs.len(), 50, "ring buffer should cap at 50 lines");
    assert!(logs[0].text.contains("line-71"));
    assert!(logs[49].text.contains("line-120"));

    let export_path = temp.path().join("exports").join("spam.log");
    let count = core
        .export_logs_to_file(
            &LogExportScope::Process(proc.id.clone()),
            &export_path,
            None,
            false,
            true,
        )
        .expect("export logs");
    assert_eq!(count, 50);

    let exported = fs::read_to_string(&export_path).expect("read exported file");
    assert!(exported.contains("line-71"));
    assert!(exported.contains("line-120"));
    assert!(!exported.contains("\x1b["), "ANSI should be stripped on plain export");

    core.clear_process_logs(&proc.id).expect("clear logs");
    assert!(core
        .get_process_logs(&proc.id, None, false)
        .expect("logs after clear")
        .is_empty());
}
