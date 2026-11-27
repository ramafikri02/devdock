use devdock_core::models::{PortInjectionMethod, ProcessStatus};
use devdock_core::ports::PortManager;
use devdock_core::DevDockCore;
use std::fs;
use std::net::TcpListener;
use std::time::{Duration, Instant};
use tempfile::TempDir;

#[test]
fn persists_port_and_applies_framework_specific_injection_args_and_env() {
    let tmp = TempDir::new().unwrap();
    let core = DevDockCore::in_memory_for_tests("/usr/bin:/bin").unwrap();

    // 1. Vite service (npm) -> default strategy is Flag (--port)
    let vite_dir = tmp.path().join("vite-app");
    fs::create_dir_all(&vite_dir).unwrap();
    fs::write(
        vite_dir.join("package.json"),
        r#"{
            "name": "vite-app",
            "devDependencies": { "vite": "^6.0.0" },
            "scripts": { "dev": "vite" }
        }"#,
    )
    .unwrap();

    let vite_proj = core.register_folder_as_project(&vite_dir, None).unwrap();
    let vite_id = &vite_proj.services[0].id;
    let allocated = core.ensure_service_port(vite_id).unwrap();
    assert_eq!(allocated, 5173);

    // Persisted in DB
    let reloaded = core.get_service(vite_id).unwrap();
    assert_eq!(reloaded.port, Some(5173));

    // Preview run spec -> npm uses `-- --port 5173`
    let (spec, _env) = core.preview_service_run_spec(vite_id, "dev").unwrap();
    assert_eq!(spec.program, "npm");
    assert_eq!(spec.args, vec!["run", "dev", "--", "--port", "5173"]);

    // 2. Next.js service (pnpm) -> default strategy is Both (PORT env + --port flag)
    let next_dir = tmp.path().join("next-app");
    fs::create_dir_all(&next_dir).unwrap();
    fs::write(next_dir.join("pnpm-lock.yaml"), "lockfileVersion: '9.0'\n").unwrap();
    fs::write(
        next_dir.join("package.json"),
        r#"{
            "name": "next-app",
            "dependencies": { "next": "^15.0.0" },
            "scripts": { "dev": "next dev" }
        }"#,
    )
    .unwrap();

    let next_proj = core.register_folder_as_project(&next_dir, None).unwrap();
    let next_id = &next_proj.services[0].id;
    core.set_service_port(next_id, Some(3050)).unwrap();

    let (next_spec, next_env) = core.preview_service_run_spec(next_id, "dev").unwrap();
    assert_eq!(next_spec.program, "pnpm");
    assert_eq!(next_spec.args, vec!["run", "dev", "--port", "3050"]);
    assert_eq!(next_env.get("PORT").map(String::as_str), Some("3050"));

    // 3. Manual override to Env only removes CLI flag
    core.set_service_port_injection(next_id, Some(PortInjectionMethod::Env))
        .unwrap();
    let (env_only_spec, env_only_map) = core.preview_service_run_spec(next_id, "dev").unwrap();
    assert_eq!(env_only_spec.args, vec!["run", "dev"]);
    assert_eq!(env_only_map.get("PORT").map(String::as_str), Some("3050"));
}

#[test]
fn detects_occupied_port_suggests_next_free_port_and_inspects_listener() {
    let tmp = TempDir::new().unwrap();
    let core = DevDockCore::in_memory_for_tests("/usr/bin:/bin").unwrap();

    // Bind a real ephemeral TCP listener in this test process
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral port");
    let occupied_port = listener.local_addr().unwrap().port();

    let svc_dir = tmp.path().join("express-api");
    fs::create_dir_all(&svc_dir).unwrap();
    fs::write(
        svc_dir.join("package.json"),
        r#"{
            "name": "express-api",
            "dependencies": { "express": "^4.21.0" },
            "scripts": { "dev": "node index.js" }
        }"#,
    )
    .unwrap();

    let proj = core.register_folder_as_project(&svc_dir, None).unwrap();
    let svc_id = &proj.services[0].id;
    core.set_service_port(svc_id, Some(occupied_port)).unwrap();

    // Pre-run port check detects occupation and suggests a free port
    let check = core.check_service_port(svc_id).unwrap();
    assert!(!check.is_available);
    assert_eq!(check.port, occupied_port);
    let suggested = check.suggested_port.expect("expected a suggested free port");
    assert_ne!(suggested, occupied_port);

    // Port inspector lists the listening port and flags it as a conflict with express-api
    let snapshot = core.inspect_listening_ports().unwrap();
    let found = snapshot
        .entries
        .iter()
        .find(|e| e.port == occupied_port)
        .expect("expected occupied test port to appear in port inspector");
    assert_eq!(found.pid, std::process::id());
    assert!(!found.is_devdock);
    assert!(found.is_conflict);
    assert_eq!(found.conflict_service_id.as_deref(), Some(svc_id.as_str()));
    assert!(snapshot.conflict_count >= 1);

    // Assigning next free port updates the service and resolves the conflict
    let updated = core.assign_next_free_port(svc_id).unwrap();
    assert_ne!(updated.port, Some(occupied_port));
    let check_after = core.check_service_port(svc_id).unwrap();
    assert!(check_after.is_available);

    drop(listener);
}

#[test]
fn extracts_conflict_port_from_common_runtime_log_formats() {
    // 1. Node.js multi-line EADDRINUSE error object dump
    let node_multiline = vec![
        "Emitted 'error' event on Server instance at:",
        "    at emitErrorNT (node:net:2045:8)",
        "  code: 'EADDRINUSE',",
        "  errno: -48,",
        "  syscall: 'listen',",
        "  address: '::',",
        "  port: 4631",
        "}",
    ];
    assert_eq!(
        PortManager::extract_conflict_port_from_lines(&node_multiline),
        Some(4631)
    );

    // 2. Single-line Node.js EADDRINUSE with IPv6 wildcard
    let node_single = vec!["Error: listen EADDRINUSE: address already in use :::3000"];
    assert_eq!(
        PortManager::extract_conflict_port_from_lines(&node_single),
        Some(3000)
    );

    // 3. Vite colored ANSI output
    let vite_ansi = vec!["\x1b[31mError: Port 5173 is already in use\x1b[0m"];
    assert_eq!(
        PortManager::extract_conflict_port_from_lines(&vite_ansi),
        Some(5173)
    );

    // 4. Go/Rust bind error
    let go_bind = vec!["listen tcp :8080: bind: address already in use"];
    assert_eq!(
        PortManager::extract_conflict_port_from_lines(&go_bind),
        Some(8080)
    );

    // 5. Unrelated crash logs should return None
    let unrelated = vec![
        "SyntaxError: Unexpected token at src/index.ts:123:45",
        "Process exited with code 1",
    ];
    assert_eq!(
        PortManager::extract_conflict_port_from_lines(&unrelated),
        None
    );
}

#[test]
fn inspects_crashed_process_port_conflict_and_detects_hardcoded_port() {
    let tmp = TempDir::new().unwrap();
    let path_env = std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".to_string());
    let core = DevDockCore::in_memory_for_tests(&path_env).unwrap();

    // Bind a real ephemeral TCP listener so PortManager sees an active owner
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral port");
    let occupied_port = listener.local_addr().unwrap().port();

    let svc_dir = tmp.path().join("hardcoded-api");
    fs::create_dir_all(&svc_dir).unwrap();
    fs::write(
        svc_dir.join("package.json"),
        format!(
            r#"{{
                "name": "hardcoded-api",
                "scripts": {{
                    "dev": "sh -c \"echo 'Error: listen EADDRINUSE: address already in use :::{}' >&2; exit 1\""
                }}
            }}"#,
            occupied_port
        ),
    )
    .unwrap();

    let proj = core.register_folder_as_project(&svc_dir, None).unwrap();
    let svc_id = &proj.services[0].id;

    // 1. Run with Port = auto (None) -> crashes on occupied_port, not yet flagged hardcoded
    let proc1 = core.run_service_script(svc_id, "dev").unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let info = core.get_process(&proc1.id).unwrap();
        if info.status == ProcessStatus::Crashed {
            break;
        }
        assert!(Instant::now() < deadline, "timed out waiting for proc1 crash");
        std::thread::sleep(Duration::from_millis(30));
    }

    let conflict1 = core
        .inspect_process_port_conflict(&proc1.id)
        .unwrap()
        .expect("expected port conflict on proc1");
    assert_eq!(conflict1.conflict_port, occupied_port);
    assert_eq!(conflict1.requested_port, None);
    assert!(!conflict1.is_likely_hardcoded);
    assert!(!conflict1.is_port_available_now);
    let owner = conflict1.owner.expect("expected OS port owner");
    assert_eq!(owner.pid, std::process::id());
    let suggested = conflict1
        .suggested_port
        .expect("expected suggested next free port");
    assert_ne!(suggested, occupied_port);

    // 2. Move service to suggested port and re-run; hardcoded script still fails on occupied_port
    core.set_service_port(svc_id, Some(suggested)).unwrap();
    let proc2 = core.run_service_script(svc_id, "dev").unwrap();
    let deadline2 = Instant::now() + Duration::from_secs(10);
    loop {
        let info = core.get_process(&proc2.id).unwrap();
        if info.status == ProcessStatus::Crashed {
            break;
        }
        assert!(Instant::now() < deadline2, "timed out waiting for proc2 crash");
        std::thread::sleep(Duration::from_millis(30));
    }

    let conflict2 = core
        .inspect_process_port_conflict(&proc2.id)
        .unwrap()
        .expect("expected port conflict on proc2");
    assert_eq!(conflict2.conflict_port, occupied_port);
    assert_eq!(conflict2.requested_port, Some(suggested));
    assert!(conflict2.is_likely_hardcoded);

    drop(listener);
}

#[test]
fn detects_wildcard_ipv6_and_ipv4_listeners_as_occupied() {
    // Node.js / Next.js commonly bind `::` (wildcard IPv6). On macOS, probing only
    // `127.0.0.1` and `::1` can falsely succeed, so wildcard binds must be detected.
    if let Ok(v6_listener) = TcpListener::bind(("::", 0)) {
        let port = v6_listener.local_addr().unwrap().port();
        assert!(
            !PortManager::is_port_available(port),
            "expected wildcard IPv6 port {port} to be reported unavailable"
        );
        drop(v6_listener);
    }

    let v4_listener = TcpListener::bind(("0.0.0.0", 0)).expect("bind wildcard IPv4");
    let v4_port = v4_listener.local_addr().unwrap().port();
    assert!(
        !PortManager::is_port_available(v4_port),
        "expected wildcard IPv4 port {v4_port} to be reported unavailable"
    );
    drop(v4_listener);
}
