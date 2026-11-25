use devdock_core::models::PortInjectionMethod;
use devdock_core::DevDockCore;
use std::fs;
use std::net::TcpListener;
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
