use devdock_core::models::{
    OrchestrationStepState, ProcessEvent, ProcessStatus, ProjectAggregateStatus,
};
use devdock_core::DevDockCore;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
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

fn wait_for_process_status(
    core: &DevDockCore,
    process_id: &str,
    expected: ProcessStatus,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    loop {
        let current = core.get_process(process_id).ok();
        if let Some(ref info) = current {
            if info.status == expected {
                return;
            }
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for process {process_id} to reach {expected:?} (last: {current:?})"
        );
        thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn start_all_respects_reordered_sequence_and_default_script() {
    let temp = TempDir::new().expect("tempdir");
    let order_log = temp.path().join("start_order.log");
    let svc_a_dir = temp.path().join("svc-frontend");
    let svc_b_dir = temp.path().join("svc-backend");

    // Use forward slashes so the path stays valid across JSON, cmd.exe, and JS string literals on Windows.
    let order_log_a = order_log.to_string_lossy().replace('\\', "/");
    let order_log_b = order_log.to_string_lossy().replace('\\', "/");

    write_service_fixture(
        &svc_a_dir,
        "svc-frontend",
        &format!(
            r#"{{
    "dev": "node -e \"require('fs').appendFileSync('{order_log_a}', 'frontend-dev\\n'); setInterval(() => {{}}, 1000);\"",
    "custom": "node -e \"require('fs').appendFileSync('{order_log_a}', 'frontend-custom\\n'); setInterval(() => {{}}, 1000);\""
  }}"#
        ),
    );
    write_service_fixture(
        &svc_b_dir,
        "svc-backend",
        &format!(
            r#"{{
    "start:dev": "node -e \"require('fs').appendFileSync('{order_log_b}', 'backend-startdev\\n'); setInterval(() => {{}}, 1000);\""
  }}"#
        ),
    );

    let core = DevDockCore::in_memory_for_tests(&host_path()).expect("core");
    let project = core
        .register_grouped_project(
            "LMS App",
            &[svc_a_dir.clone(), svc_b_dir.clone()],
            Some(temp.path()),
        )
        .expect("register grouped");

    let frontend = &project.services[0];
    let backend = &project.services[1];

    // Reorder so backend (#0) starts before frontend (#1), and set custom default script on frontend
    let reordered = core
        .reorder_project_services(&project.id, &[backend.id.clone(), frontend.id.clone()])
        .expect("reorder");
    assert_eq!(reordered.services[0].id, backend.id);
    assert_eq!(reordered.services[1].id, frontend.id);

    let updated_fe = core
        .set_service_default_script(&frontend.id, Some("custom"))
        .expect("set default script");
    assert_eq!(updated_fe.default_script.as_deref(), Some("custom"));

    // Subscribe to orchestration step events
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_ref = Arc::clone(&events);
    core.subscribe_process_events(Arc::new(move |ev| {
        if let ProcessEvent::OrchestrationStep(step) = ev {
            events_ref.lock().unwrap().push(step);
        }
    }));

    let res = core.start_project_all(&project.id).expect("start all");
    assert_eq!(res.started_process_ids.len(), 2);
    assert_eq!(res.status.status, ProjectAggregateStatus::AllRunning);
    assert_eq!(res.status.running_services, 2);
    assert_eq!(res.steps[0].service_id, backend.id);
    assert_eq!(res.steps[0].state, OrchestrationStepState::Running);
    assert_eq!(res.steps[1].service_id, frontend.id);
    assert_eq!(res.steps[1].script.as_deref(), Some("custom"));
    assert_eq!(res.steps[1].state, OrchestrationStepState::Running);

    // Verify both processes actually executed the expected scripts (including frontend's custom default script).
    // Child `npm` -> `node` startup times vary under OS scheduling, so check membership rather than file-write race order.
    let deadline = Instant::now() + Duration::from_secs(15);
    let contents = loop {
        let text = fs::read_to_string(&order_log).unwrap_or_default();
        if text.lines().count() >= 2 {
            break text;
        }
        assert!(Instant::now() < deadline, "timed out waiting for order log: {text}");
        thread::sleep(Duration::from_millis(25));
    };
    let mut lines: Vec<&str> = contents.lines().collect();
    lines.sort_unstable();
    assert_eq!(lines, vec!["backend-startdev", "frontend-custom"]);

    // Verify orchestration spawned backend strictly before frontend
    let first_proc = core.get_process(&res.started_process_ids[0]).expect("first proc");
    let second_proc = core.get_process(&res.started_process_ids[1]).expect("second proc");
    assert_eq!(first_proc.service_id, backend.id);
    assert_eq!(first_proc.script, "start:dev");
    assert_eq!(second_proc.service_id, frontend.id);
    assert_eq!(second_proc.script, "custom");

    let recorded_events = events.lock().unwrap().clone();
    let backend_running_idx = recorded_events
        .iter()
        .position(|e| e.service_id == backend.id && e.state == OrchestrationStepState::Running)
        .expect("backend running event");
    let frontend_starting_idx = recorded_events
        .iter()
        .position(|e| e.service_id == frontend.id && e.state == OrchestrationStepState::Starting)
        .expect("frontend starting event");
    assert!(
        backend_running_idx < frontend_starting_idx,
        "expected backend to be started before frontend"
    );
    assert!(recorded_events
        .iter()
        .any(|e| e.service_id == backend.id && e.state == OrchestrationStepState::Waiting));

    // Restart all & verify new PIDs started and old stopped
    let restart_res = core.restart_project_all(&project.id).expect("restart all");
    assert_eq!(restart_res.stopped_process_ids.len(), 2);
    assert_eq!(restart_res.started_process_ids.len(), 2);
    assert_eq!(restart_res.status.status, ProjectAggregateStatus::AllRunning);

    // Stop all
    let stop_res = core.stop_project_all(&project.id).expect("stop all");
    assert_eq!(stop_res.stopped_process_ids.len(), 2);
    assert_eq!(stop_res.status.status, ProjectAggregateStatus::Stopped);
    assert_eq!(stop_res.status.running_services, 0);
}

#[test]
fn compute_project_status_reports_stopped_partial_all_running_and_crashed() {
    let temp = TempDir::new().expect("tempdir");
    let svc_a_dir = temp.path().join("svc-a");
    let svc_b_dir = temp.path().join("svc-b");

    write_service_fixture(
        &svc_a_dir,
        "svc-a",
        r#"{ "dev": "node -e \"setInterval(() => {}, 1000)\"", "fail": "node -e \"process.exit(1)\"" }"#,
    );
    write_service_fixture(
        &svc_b_dir,
        "svc-b",
        r#"{ "dev": "node -e \"setInterval(() => {}, 1000)\"" }"#,
    );

    let core = DevDockCore::in_memory_for_tests(&host_path()).expect("core");
    let project = core
        .register_grouped_project("StatusApp", &[svc_a_dir, svc_b_dir], None)
        .expect("register");

    let svc_a = &project.services[0];
    let svc_b = &project.services[1];

    // Initially stopped
    let s0 = core.compute_project_status(&project.id).expect("status");
    assert_eq!(s0.status, ProjectAggregateStatus::Stopped);
    assert_eq!(s0.running_services, 0);

    // 1 running -> Partial
    let p_a = core.run_service_script(&svc_a.id, "dev").expect("run a");
    let s1 = core.compute_project_status(&project.id).expect("status");
    assert_eq!(s1.status, ProjectAggregateStatus::Partial);
    assert_eq!(s1.running_services, 1);

    // 2 running -> AllRunning
    let p_b = core.run_service_script(&svc_b.id, "dev").expect("run b");
    let s2 = core.compute_project_status(&project.id).expect("status");
    assert_eq!(s2.status, ProjectAggregateStatus::AllRunning);
    assert_eq!(s2.running_services, 2);

    // Stop both -> Stopped
    core.stop_process(&p_a.id).expect("stop a");
    core.stop_process(&p_b.id).expect("stop b");
    let s3 = core.compute_project_status(&project.id).expect("status");
    assert_eq!(s3.status, ProjectAggregateStatus::Stopped);

    // Crash svc_a -> Crashed
    let p_fail = core.run_service_script(&svc_a.id, "fail").expect("run fail");
    wait_for_process_status(&core, &p_fail.id, ProcessStatus::Crashed, Duration::from_secs(15));
    let s4 = core.compute_project_status(&project.id).expect("status");
    assert_eq!(s4.status, ProjectAggregateStatus::Crashed);
    assert_eq!(s4.crashed_services, 1);
}

#[test]
fn start_all_skips_library_packages_without_dev_scripts_and_cleared_defaults() {
    let temp = TempDir::new().expect("tempdir");
    let api_dir = temp.path().join("api");
    let auth_pkg_dir = temp.path().join("auth");

    write_service_fixture(
        &api_dir,
        "@luno/api",
        r#"{ "dev": "node -e \"setInterval(() => {}, 1000)\"", "typecheck": "tsc --noEmit" }"#,
    );
    write_service_fixture(
        &auth_pkg_dir,
        "@luno/auth",
        r#"{ "generate": "node -e \"process.exit(2)\"", "typecheck": "tsc --noEmit" }"#,
    );

    let core = DevDockCore::in_memory_for_tests(&host_path()).expect("core");
    let project = core
        .register_grouped_project("Luno", &[api_dir, auth_pkg_dir], Some(temp.path()))
        .expect("register");

    let api = &project.services[0];
    let auth = &project.services[1];

    // @luno/api picks `dev`, while library package @luno/auth does NOT pick `generate`
    assert_eq!(api.default_script.as_deref(), Some("dev"));
    assert_eq!(auth.default_script, None);

    let res = core.start_project_all(&project.id).expect("start all");
    assert_eq!(res.started_process_ids.len(), 1);
    assert_eq!(res.steps[0].service_id, api.id);
    assert_eq!(res.steps[0].state, OrchestrationStepState::Running);
    assert_eq!(res.steps[1].service_id, auth.id);
    assert_eq!(res.steps[1].state, OrchestrationStepState::Skipped);

    core.stop_project_all(&project.id).expect("stop all");

    // Explicitly clearing default_script on @luno/api also skips it during Start All
    core.set_service_default_script(&api.id, None)
        .expect("clear default script");
    let res2 = core.start_project_all(&project.id).expect("start all 2");
    assert_eq!(res2.started_process_ids.len(), 0);
    assert!(res2
        .steps
        .iter()
        .all(|s| s.state == OrchestrationStepState::Skipped));
}
