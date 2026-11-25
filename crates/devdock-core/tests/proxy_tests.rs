use devdock_core::proxy::{build_hosts_file_content, service_domain_slug};
use devdock_core::DevDockCore;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::thread;
use tempfile::TempDir;

fn host_path() -> String {
    std::env::var("PATH").unwrap_or_else(|_| "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin".into())
}

fn write_service_fixture(dir: &Path, name: &str) {
    fs::create_dir_all(dir).expect("create fixture dir");
    let pkg = format!(
        r#"{{
  "name": "{name}",
  "version": "1.0.0",
  "scripts": {{ "dev": "node -e \"setInterval(() => {{}}, 1000)\"" }}
}}"#
    );
    fs::write(dir.join("package.json"), pkg).expect("write package.json");
}

fn spawn_mock_http_server(label: &'static str) -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind mock upstream");
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut sock) = stream else { break };
            thread::spawn(move || {
                let mut buf = [0u8; 4096];
                let n = sock.read(&mut buf).unwrap_or(0);
                if n == 0 {
                    return;
                }
                let req = String::from_utf8_lossy(&buf[..n]);
                let first_line = req.lines().next().unwrap_or("");
                let path = first_line.split_whitespace().nth(1).unwrap_or("/");

                if req.to_ascii_lowercase().contains("upgrade: websocket") {
                    let resp = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n";
                    let _ = sock.write_all(resp.as_bytes());
                    let _ = sock.flush();
                    // Echo one payload back over the upgraded WebSocket tunnel
                    let mut ws_buf = [0u8; 1024];
                    if let Ok(m) = sock.read(&mut ws_buf) {
                        if m > 0 {
                            let _ = sock.write_all(&ws_buf[..m]);
                            let _ = sock.flush();
                        }
                    }
                    return;
                }

                let body = format!("{label}:{path}");
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes());
                let _ = sock.flush();
            });
        }
    });
    port
}

fn send_raw_http_request(proxy_port: u16, host_header: &str, path: &str) -> String {
    let mut sock = TcpStream::connect(("127.0.0.1", proxy_port)).expect("connect to proxy");
    let req = format!("GET {path} HTTP/1.1\r\nHost: {host_header}\r\nConnection: close\r\n\r\n");
    sock.write_all(req.as_bytes()).expect("write request");
    sock.flush().expect("flush");
    let mut resp = String::new();
    sock.read_to_string(&mut resp).expect("read response");
    resp
}

#[test]
fn reverse_proxy_routes_hosts_handles_errors_dynamic_updates_and_websocket() {
    let temp = TempDir::new().expect("tempdir");
    let svc_a_dir = temp.path().join("lms-frontend");
    let svc_b_dir = temp.path().join("lms-backend");
    let svc_c_dir = temp.path().join("billing-api");
    write_service_fixture(&svc_a_dir, "lms-frontend");
    write_service_fixture(&svc_b_dir, "lms-backend");
    write_service_fixture(&svc_c_dir, "billing-api");

    let upstream_a = spawn_mock_http_server("FRONTEND");
    let upstream_b = spawn_mock_http_server("BACKEND");

    // Pick a closed port for 502 test
    let closed_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let closed_port = closed_listener.local_addr().unwrap().port();
    drop(closed_listener);

    let core = DevDockCore::in_memory_for_tests(&host_path()).expect("core");
    let project = core
        .register_grouped_project("LMS", &[svc_a_dir, svc_b_dir], None)
        .expect("register grouped");
    let svc_a = &project.services[0];
    let svc_b = &project.services[1];

    core.set_service_port(&svc_a.id, Some(upstream_a)).unwrap();
    core.set_service_port(&svc_b.id, Some(upstream_b)).unwrap();

    let status = core.start_proxy_on_port(0).expect("start proxy on ephemeral port");
    assert!(status.running);
    let proxy_port = status.bound_port.expect("bound port");

    // 1. Host header routing (with and without :port)
    let resp_a = send_raw_http_request(proxy_port, &format!("lms-frontend.localhost:{proxy_port}"), "/courses");
    assert!(resp_a.starts_with("HTTP/1.1 200 OK"), "resp_a={resp_a}");
    assert!(resp_a.ends_with("FRONTEND:/courses"), "resp_a={resp_a}");

    let resp_b = send_raw_http_request(proxy_port, "lms-backend.localhost", "/api/health");
    assert!(resp_b.starts_with("HTTP/1.1 200 OK"), "resp_b={resp_b}");
    assert!(resp_b.ends_with("BACKEND:/api/health"), "resp_b={resp_b}");

    // 2. Unknown host -> 404 Not Found
    let resp_404 = send_raw_http_request(proxy_port, "unknown-app.localhost", "/");
    assert!(resp_404.starts_with("HTTP/1.1 404 Not Found"), "resp_404={resp_404}");

    // 3. Unreachable upstream -> 502 Bad Gateway
    core.set_service_port(&svc_b.id, Some(closed_port)).unwrap();
    core.sync_proxy_routes().unwrap();
    let resp_502 = send_raw_http_request(proxy_port, "lms-backend.localhost", "/");
    assert!(resp_502.starts_with("HTTP/1.1 502 Bad Gateway"), "resp_502={resp_502}");

    // 4. Dynamic route addition without proxy restart
    let upstream_c = spawn_mock_http_server("BILLING");
    let svc_c = core
        .attach_folder_to_project(&project.id, &svc_c_dir, Some("Billing API"))
        .unwrap();
    core.set_service_port(&svc_c.id, Some(upstream_c)).unwrap();
    core.sync_proxy_routes().unwrap();
    let resp_c = send_raw_http_request(proxy_port, "billing-api.localhost", "/invoices");
    assert!(resp_c.ends_with("BILLING:/invoices"), "resp_c={resp_c}");

    // 5. WebSocket / HMR bidirectional upgrade passthrough
    let mut ws_sock = TcpStream::connect(("127.0.0.1", proxy_port)).expect("ws connect");
    let upgrade_req = "GET /_hmr HTTP/1.1\r\nHost: lms-frontend.localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n";
    ws_sock.write_all(upgrade_req.as_bytes()).unwrap();
    ws_sock.flush().unwrap();
    let mut upgrade_buf = [0u8; 512];
    let n = ws_sock.read(&mut upgrade_buf).unwrap();
    let upgrade_resp = String::from_utf8_lossy(&upgrade_buf[..n]);
    assert!(upgrade_resp.contains("101 Switching Protocols"), "upgrade_resp={upgrade_resp}");

    ws_sock.write_all(b"HMR_PING").unwrap();
    ws_sock.flush().unwrap();
    let m = ws_sock.read(&mut upgrade_buf).unwrap();
    assert_eq!(&upgrade_buf[..m], b"HMR_PING");

    let stopped = core.stop_proxy().unwrap();
    assert!(!stopped.running);
}

#[test]
fn domain_slug_and_hosts_file_builder_are_clean_and_idempotent() {
    assert_eq!(service_domain_slug("@h2o/lms-frontend"), "lms-frontend");
    assert_eq!(service_domain_slug("Billing API v2"), "billing-api-v2");

    let existing = "127.0.0.1\tlocalhost\n::1\tlocalhost\n";
    let domains = vec![
        "lms-backend.localhost".to_string(),
        "lms-frontend.localhost".to_string(),
    ];
    let once = build_hosts_file_content(existing, &domains);
    assert!(once.contains("127.0.0.1\tlms-backend.localhost"));
    assert!(once.contains("127.0.0.1\tlms-frontend.localhost"));

    // Updating again replaces the managed block cleanly without duplicating entries
    let twice = build_hosts_file_content(&once, &["api.localhost".to_string()]);
    assert!(!twice.contains("lms-backend.localhost"));
    assert!(twice.contains("127.0.0.1\tapi.localhost"));
    assert!(twice.contains("127.0.0.1\tlocalhost"));
}
