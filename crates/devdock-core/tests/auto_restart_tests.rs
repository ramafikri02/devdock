use devdock_core::models::{ProcessEvent, ProcessStatus};
use devdock_core::process_manager::AutoRestartPolicy;
use devdock_core::traits::InMemoryNotifier;
use devdock_core::DevDockCore;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tempfile::TempDir;

#[cfg(unix)]
fn write_exec(path: &Path, content: &str) {
    use std::os::unix::fs::PermissionsExt;
    fs::write(path, content).unwrap();
    let mut perms = fs::metadata(path).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms).unwrap();
}

fn wait_for_status(core: &DevDockCore, process_id: &str, target: ProcessStatus, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(info) = core.get_process(process_id) {
            if info.status == target {
                return;
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let current = core.get_process(process_id).ok();
    panic!("Timed out waiting for process {process_id} to reach {target:?}, last={current:?}");
}

#[cfg(unix)]
#[test]
fn auto_restart_caps_at_3_within_window_and_notifies_on_exhaustion() {
    let tmp = TempDir::new().unwrap();
    let bin_dir = tmp.path().join("bin");
    fs::create_dir_all(&bin_dir).unwrap();

    // Fake npm that immediately crashes with stderr message
    write_exec(
        &bin_dir.join("npm"),
        "#!/bin/sh\necho \"ECONNREFUSED database unreachable\" >&2\nexit 1\n",
    );

    let notifier = Arc::new(InMemoryNotifier::new());
    let path_env = format!("{}:/usr/bin:/bin", bin_dir.display());
    let core = DevDockCore::in_memory_for_tests_with_notifier(&path_env, notifier.clone()).unwrap();
    core.set_auto_restart_policy(AutoRestartPolicy {
        max_restarts: 3,
        window: Duration::from_secs(60),
        backoff: Duration::from_millis(40),
    });

    let crash_events = Arc::new(Mutex::new(Vec::new()));
    let crash_cb = Arc::clone(&crash_events);
    core.subscribe_process_events(Arc::new(move |ev| {
        if let ProcessEvent::CrashNotification(c) = ev {
            crash_cb.lock().unwrap().push(c);
        }
    }));

    let svc_dir = tmp.path().join("crashing-api");
    fs::create_dir_all(&svc_dir).unwrap();
    fs::write(
        svc_dir.join("package.json"),
        r#"{"name": "crashing-api", "scripts": { "dev": "node crash.js" }}"#,
    )
    .unwrap();

    let proj = core.register_folder_as_project(&svc_dir, None).unwrap();
    let svc_id = &proj.services[0].id;

    // Enable persisted auto-restart for "dev"
    let updated = core.set_script_auto_restart(svc_id, "dev", true).unwrap();
    assert!(updated.auto_restart_scripts.contains(&"dev".to_string()));

    let proc = core.run_service_script(svc_id, "dev").unwrap();
    wait_for_status(&core, &proc.id, ProcessStatus::Crashed, Duration::from_secs(5));

    let final_info = core.get_process(&proc.id).unwrap();
    assert_eq!(final_info.status, ProcessStatus::Crashed);
    assert_eq!(final_info.restart_count, 3);
    assert_eq!(final_info.exit_code, Some(1));
    assert!(final_info
        .crash_reason
        .as_deref()
        .unwrap_or("")
        .contains("Auto-restart"));
    assert!(final_info
        .last_error_snippet
        .as_deref()
        .unwrap_or("")
        .contains("ECONNREFUSED"));

    // OS notification delivered exactly once (on exhaustion)
    let sent = notifier.notifications();
    assert_eq!(sent.len(), 1);
    assert!(sent[0].title.contains("crashing-api"));
    assert!(sent[0].body.contains("ECONNREFUSED"));

    // CrashNotification event emitted with auto_restart_exhausted = true
    let recorded = crash_events.lock().unwrap();
    assert_eq!(recorded.len(), 1);
    assert!(recorded[0].auto_restart_exhausted);
}

#[cfg(unix)]
#[test]
fn non_zero_crash_without_auto_restart_notifies_immediately() {
    let tmp = TempDir::new().unwrap();
    let bin_dir = tmp.path().join("bin");
    fs::create_dir_all(&bin_dir).unwrap();

    write_exec(
        &bin_dir.join("npm"),
        "#!/bin/sh\necho \"SyntaxError: unexpected token\" >&2\nexit 2\n",
    );

    let notifier = Arc::new(InMemoryNotifier::new());
    let path_env = format!("{}:/usr/bin:/bin", bin_dir.display());
    let core = DevDockCore::in_memory_for_tests_with_notifier(&path_env, notifier.clone()).unwrap();

    let svc_dir = tmp.path().join("no-restart-svc");
    fs::create_dir_all(&svc_dir).unwrap();
    fs::write(
        svc_dir.join("package.json"),
        r#"{"name": "no-restart-svc", "scripts": { "dev": "node bad.js" }}"#,
    )
    .unwrap();

    let proj = core.register_folder_as_project(&svc_dir, None).unwrap();
    let svc_id = &proj.services[0].id;

    let proc = core.run_service_script(svc_id, "dev").unwrap();
    wait_for_status(&core, &proc.id, ProcessStatus::Crashed, Duration::from_secs(5));

    let final_info = core.get_process(&proc.id).unwrap();
    assert_eq!(final_info.restart_count, 0);
    assert_eq!(final_info.exit_code, Some(2));
    assert!(final_info
        .last_error_snippet
        .as_deref()
        .unwrap_or("")
        .contains("SyntaxError"));

    let sent = notifier.notifications();
    assert_eq!(sent.len(), 1);
    assert!(sent[0].title.contains("no-restart-svc"));
}

#[cfg(unix)]
#[test]
fn auto_restart_window_resets_allowing_more_than_3_total_restarts_over_time() {
    let tmp = TempDir::new().unwrap();
    let bin_dir = tmp.path().join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    let counter_file = tmp.path().join("runs.txt");

    // Each run sleeps 140ms then crashes for the first 4 runs, and exits 0 on the 5th run.
    // With window=300ms and max_restarts=3, earlier restart timestamps expire so the 4th restart succeeds!
    let script = format!(
        r#"#!/bin/sh
COUNT=0
if [ -f "{counter}" ]; then
  COUNT=$(cat "{counter}")
fi
COUNT=$((COUNT + 1))
echo "$COUNT" > "{counter}"
sleep 0.14
if [ "$COUNT" -lt 5 ]; then
  echo "transient crash #$COUNT" >&2
  exit 1
fi
echo "recovered on run #$COUNT"
exit 0
"#,
        counter = counter_file.display()
    );
    write_exec(&bin_dir.join("npm"), &script);

    let notifier = Arc::new(InMemoryNotifier::new());
    let path_env = format!("{}:/usr/bin:/bin", bin_dir.display());
    let core = DevDockCore::in_memory_for_tests_with_notifier(&path_env, notifier.clone()).unwrap();
    core.set_auto_restart_policy(AutoRestartPolicy {
        max_restarts: 3,
        window: Duration::from_millis(320),
        backoff: Duration::from_millis(20),
    });

    let svc_dir = tmp.path().join("flaky-svc");
    fs::create_dir_all(&svc_dir).unwrap();
    fs::write(
        svc_dir.join("package.json"),
        r#"{"name": "flaky-svc", "scripts": { "dev": "node flaky.js" }}"#,
    )
    .unwrap();

    let proj = core.register_folder_as_project(&svc_dir, None).unwrap();
    let svc_id = &proj.services[0].id;
    core.set_script_auto_restart(svc_id, "dev", true).unwrap();

    let proc = core.run_service_script(svc_id, "dev").unwrap();
    wait_for_status(&core, &proc.id, ProcessStatus::Stopped, Duration::from_secs(6));

    let final_info = core.get_process(&proc.id).unwrap();
    assert_eq!(final_info.status, ProcessStatus::Stopped);
    assert_eq!(final_info.exit_code, Some(0));
    assert_eq!(final_info.restart_count, 4);
    assert!(notifier.notifications().is_empty());
}
