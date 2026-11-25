use devdock_core::models::{ProcessInfo, ProcessStatus};
use devdock_core::monitor::{
    OsProcessStat, ResourceMonitor, DEFAULT_METRIC_MAX_POINTS, DEFAULT_METRIC_RETENTION,
};
use devdock_core::DevDockCore;
use std::fs;
use std::path::Path;
use std::time::Duration;
use tempfile::TempDir;

#[cfg(unix)]
fn write_exec(path: &Path, content: &str) {
    use std::os::unix::fs::PermissionsExt;
    fs::write(path, content).unwrap();
    let mut perms = fs::metadata(path).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms).unwrap();
}

#[cfg(unix)]
#[test]
fn samples_and_aggregates_real_child_spawning_process_tree() {
    let tmp = TempDir::new().unwrap();
    let bin_dir = tmp.path().join("bin");
    fs::create_dir_all(&bin_dir).unwrap();

    // Fake npm that spawns two real background child processes (`sleep 30`) so tree_process_count >= 3
    write_exec(
        &bin_dir.join("npm"),
        "#!/bin/sh\nsleep 30 &\nsleep 30 &\nwait\n",
    );

    let path_env = format!("{}:/usr/bin:/bin", bin_dir.display());
    let core = DevDockCore::in_memory_for_tests(&path_env).unwrap();

    let svc_dir = tmp.path().join("monitored-svc");
    fs::create_dir_all(&svc_dir).unwrap();
    fs::write(
        svc_dir.join("package.json"),
        r#"{"name": "monitored-svc", "scripts": { "dev": "run" }}"#,
    )
    .unwrap();

    let proj = core.register_folder_as_project(&svc_dir, None).unwrap();
    let svc_id = &proj.services[0].id;
    let proc = core.run_service_script(svc_id, "dev").unwrap();

    // Wait until the shell has spawned its 2 child `sleep` processes
    let root_pid = proc.pid.expect("running process pid");
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    loop {
        let stats = devdock_core::monitor::collect_os_process_stats();
        let tree_len = stats
            .iter()
            .filter(|s| s.pid == root_pid || s.ppid == root_pid || s.pgid == root_pid)
            .count();
        if tree_len >= 3 || std::time::Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(40));
    }

    let snap1 = core.sample_metrics();
    let proc_metrics = snap1
        .by_process
        .get(&proc.id)
        .expect("expected metrics for running process");
    assert!(
        proc_metrics.tree_process_count >= 3,
        "expected parent + 2 children in process tree, got {}",
        proc_metrics.tree_process_count
    );
    assert!(proc_metrics.current_memory_bytes > 0);
    assert_eq!(proc_metrics.history.len(), 1);

    // Service, project, and global totals should match
    let svc_metrics = snap1
        .by_service
        .get(svc_id)
        .expect("expected service metrics");
    assert_eq!(
        svc_metrics.current_memory_bytes,
        proc_metrics.current_memory_bytes
    );

    let proj_metrics = snap1
        .by_project
        .get(&proj.id)
        .expect("expected project metrics");
    assert_eq!(
        proj_metrics.current_memory_bytes,
        proc_metrics.current_memory_bytes
    );
    assert_eq!(snap1.total_memory_bytes, proc_metrics.current_memory_bytes);

    // Second sample appends to rolling history
    let snap2 = core.sample_metrics();
    assert_eq!(snap2.global_history.len(), 2);
    assert_eq!(snap2.by_process[&proc.id].history.len(), 2);

    core.stop_process(&proc.id).unwrap();
}

#[test]
fn enforces_15_minute_ring_buffer_retention_and_tree_aggregation() {
    let monitor = ResourceMonitor::new(DEFAULT_METRIC_RETENTION, DEFAULT_METRIC_MAX_POINTS);

    let proc = ProcessInfo {
        id: "proc-1".to_string(),
        project_id: "proj-1".to_string(),
        service_id: "svc-1".to_string(),
        service_name: "api".to_string(),
        script: "dev".to_string(),
        command: "pnpm run dev".to_string(),
        pid: Some(1000),
        status: ProcessStatus::Running,
        exit_code: None,
        started_at: "2026-01-01T00:00:00Z".to_string(),
        finished_at: None,
        duration_ms: None,
        line_count: 0,
        auto_restart: false,
        restart_count: 0,
        crash_reason: None,
        last_error_snippet: None,
    };

    // Parent (1000) -> child (1001) -> grandchild (1002), plus unrelated (9999)
    let stats = vec![
        OsProcessStat {
            pid: 1000,
            ppid: 1,
            pgid: 1000,
            cpu_percent: 2.5,
            memory_bytes: 10 * 1024 * 1024,
        },
        OsProcessStat {
            pid: 1001,
            ppid: 1000,
            pgid: 1000,
            cpu_percent: 12.0,
            memory_bytes: 50 * 1024 * 1024,
        },
        OsProcessStat {
            pid: 1002,
            ppid: 1001,
            pgid: 1000,
            cpu_percent: 5.5,
            memory_bytes: 40 * 1024 * 1024,
        },
        OsProcessStat {
            pid: 9999,
            ppid: 1,
            pgid: 9999,
            cpu_percent: 99.0,
            memory_bytes: 500 * 1024 * 1024,
        },
    ];

    // Push 600 samples spaced 2 seconds apart (20 minutes total)
    let base_ts: i64 = 1_700_000_000_000;
    let mut last_snap = None;
    for i in 0..600_i64 {
        last_snap = Some(monitor.sample_with_stats(&[proc.clone()], &stats, base_ts + i * 2_000));
    }

    let snap = last_snap.unwrap();
    // Unrelated PID 9999 must not be counted; tree sum = 20.0% CPU, 100 MiB RAM, 3 processes
    assert_eq!(snap.total_cpu_percent, 20.0);
    assert_eq!(snap.total_memory_bytes, 100 * 1024 * 1024);
    assert_eq!(snap.by_process["proc-1"].tree_process_count, 3);

    // Ring buffer retains at most 450 points (15 minutes at 2s interval)
    assert!(snap.global_history.len() <= DEFAULT_METRIC_MAX_POINTS);
    assert_eq!(snap.global_history.len(), DEFAULT_METRIC_MAX_POINTS);
    let oldest = snap.global_history.first().unwrap().timestamp_ms;
    let newest = snap.global_history.last().unwrap().timestamp_ms;
    assert!(newest - oldest <= DEFAULT_METRIC_RETENTION.as_millis() as i64);
}
