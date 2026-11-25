use crate::error::{CoreError, CoreResult};
use crate::models::{
    HostsSyncPreview, HostsSyncResult, ProcessInfo, Project, ProxyRouteInfo, ProxyStatus,
};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

pub const DEFAULT_PROXY_PREFERRED_PORT: u16 = 80;
pub const DEFAULT_PROXY_FALLBACK_PORT: u16 = 2999;

const MAX_HEADER_BYTES: usize = 64 * 1024;
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(5);
const UPSTREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

const HOSTS_BEGIN_MARKER: &str = "# >>> DevDock Local Domains";
const HOSTS_END_MARKER: &str = "# <<< DevDock Local Domains";

#[derive(Debug, Clone)]
pub struct ProxyRoute {
    pub service_id: String,
    pub service_name: String,
    pub project_id: String,
    pub domain: String,
    pub target_port: u16,
    pub is_running: bool,
}

#[derive(Debug, Clone)]
struct RuntimeState {
    enabled: bool,
    running: bool,
    preferred_port: u16,
    bound_port: Option<u16>,
    used_fallback: bool,
    fallback_port: u16,
    error: Option<String>,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            enabled: true,
            running: false,
            preferred_port: DEFAULT_PROXY_PREFERRED_PORT,
            bound_port: None,
            used_fallback: false,
            fallback_port: DEFAULT_PROXY_FALLBACK_PORT,
            error: None,
        }
    }
}

pub struct LocalDomainProxy {
    routes: Arc<RwLock<HashMap<String, ProxyRoute>>>,
    state: Arc<RwLock<RuntimeState>>,
    shutdown_tx: Mutex<Option<watch::Sender<bool>>>,
    worker_thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl Default for LocalDomainProxy {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalDomainProxy {
    pub fn new() -> Self {
        Self {
            routes: Arc::new(RwLock::new(HashMap::new())),
            state: Arc::new(RwLock::new(RuntimeState::default())),
            shutdown_tx: Mutex::new(None),
            worker_thread: Mutex::new(None),
        }
    }

    pub fn set_enabled_flag(&self, enabled: bool) {
        self.state.write().expect("proxy state poisoned").enabled = enabled;
    }

    pub fn is_enabled(&self) -> bool {
        self.state.read().expect("proxy state poisoned").enabled
    }

    pub fn set_routes_from_projects(&self, projects: &[Project], processes: &[ProcessInfo]) {
        let running_service_ids: HashSet<&str> = processes
            .iter()
            .filter(|p| p.status.is_active())
            .map(|p| p.service_id.as_str())
            .collect();

        let mut used_slugs: HashSet<String> = HashSet::new();
        let mut next_routes: HashMap<String, ProxyRoute> = HashMap::new();

        for project in projects {
            for svc in &project.services {
                let Some(port) = svc.port else {
                    continue;
                };
                let base_slug = service_domain_slug(&svc.name);
                let mut slug = base_slug.clone();
                let mut suffix = 2usize;
                while used_slugs.contains(&slug) {
                    slug = format!("{base_slug}-{suffix}");
                    suffix += 1;
                }
                used_slugs.insert(slug.clone());

                let domain = format!("{slug}.localhost");
                next_routes.insert(
                    domain.clone(),
                    ProxyRoute {
                        service_id: svc.id.clone(),
                        service_name: svc.name.clone(),
                        project_id: project.id.clone(),
                        domain,
                        target_port: port,
                        is_running: running_service_ids.contains(svc.id.as_str()),
                    },
                );
            }
        }

        *self.routes.write().expect("proxy routes poisoned") = next_routes;
    }

    pub fn start(&self, preferred_port: u16, fallback_start: u16) -> CoreResult<ProxyStatus> {
        self.stop();

        {
            let mut st = self.state.write().expect("proxy state poisoned");
            st.enabled = true;
            st.preferred_port = preferred_port;
            st.fallback_port = fallback_start;
            st.error = None;
        }

        let (tx, rx) = watch::channel(false);
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel::<Result<(u16, bool), String>>(1);

        let routes = Arc::clone(&self.routes);
        let state = Arc::clone(&self.state);

        let handle = std::thread::Builder::new()
            .name("devdock-local-proxy".to_string())
            .spawn(move || {
                let rt = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(rt) => rt,
                    Err(err) => {
                        let _ = ready_tx.send(Err(format!("Failed to start proxy runtime: {err}")));
                        return;
                    }
                };

                rt.block_on(async move {
                    let bind_result = bind_with_fallback(preferred_port, fallback_start).await;
                    let (listener, bound_port, used_fallback) = match bind_result {
                        Ok(res) => res,
                        Err(err) => {
                            {
                                let mut st = state.write().expect("proxy state poisoned");
                                st.running = false;
                                st.bound_port = None;
                                st.used_fallback = false;
                                st.error = Some(err.clone());
                            }
                            let _ = ready_tx.send(Err(err));
                            return;
                        }
                    };

                    {
                        let mut st = state.write().expect("proxy state poisoned");
                        st.running = true;
                        st.bound_port = Some(bound_port);
                        st.used_fallback = used_fallback;
                        st.error = None;
                    }
                    let _ = ready_tx.send(Ok((bound_port, used_fallback)));

                    let mut shutdown_rx = rx;
                    loop {
                        tokio::select! {
                            biased;
                            changed = shutdown_rx.changed() => {
                                if changed.is_err() || *shutdown_rx.borrow() {
                                    break;
                                }
                            }
                            accept_res = listener.accept() => {
                                match accept_res {
                                    Ok((stream, _peer)) => {
                                        let routes_ref = Arc::clone(&routes);
                                        tokio::spawn(async move {
                                            let _ = handle_client_connection(stream, routes_ref).await;
                                        });
                                    }
                                    Err(_) => {
                                        tokio::time::sleep(Duration::from_millis(20)).await;
                                    }
                                }
                            }
                        }
                    }

                    let mut st = state.write().expect("proxy state poisoned");
                    st.running = false;
                    st.bound_port = None;
                    st.used_fallback = false;
                });
            })
            .map_err(CoreError::Io)?;

        *self.shutdown_tx.lock().expect("shutdown tx poisoned") = Some(tx);
        *self.worker_thread.lock().expect("worker thread poisoned") = Some(handle);

        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(_)) => Ok(self.status()),
            Ok(Err(err)) => {
                self.stop();
                Err(CoreError::Adapter(err))
            }
            Err(_) => {
                self.stop();
                Err(CoreError::Adapter(
                    "Timed out waiting for local domain proxy to bind".to_string(),
                ))
            }
        }
    }

    pub fn stop(&self) {
        if let Some(tx) = self.shutdown_tx.lock().expect("shutdown tx poisoned").take() {
            let _ = tx.send(true);
        }
        if let Some(handle) = self
            .worker_thread
            .lock()
            .expect("worker thread poisoned")
            .take()
        {
            let _ = handle.join();
        }
        let mut st = self.state.write().expect("proxy state poisoned");
        st.running = false;
        st.bound_port = None;
        st.used_fallback = false;
    }

    pub fn status(&self) -> ProxyStatus {
        let st = self.state.read().expect("proxy state poisoned").clone();
        let display_port = st.bound_port.unwrap_or(st.preferred_port);
        let mut routes: Vec<ProxyRouteInfo> = self
            .routes
            .read()
            .expect("proxy routes poisoned")
            .values()
            .map(|r| ProxyRouteInfo {
                service_id: r.service_id.clone(),
                service_name: r.service_name.clone(),
                project_id: r.project_id.clone(),
                domain: r.domain.clone(),
                target_port: r.target_port,
                url: format_local_domain_url(&r.domain, display_port),
                is_running: r.is_running,
            })
            .collect();
        routes.sort_by(|a, b| a.domain.cmp(&b.domain));

        ProxyStatus {
            enabled: st.enabled,
            running: st.running,
            preferred_port: st.preferred_port,
            bound_port: st.bound_port,
            used_fallback: st.used_fallback,
            fallback_port: st.fallback_port,
            error: st.error,
            routes,
        }
    }
}

impl Drop for LocalDomainProxy {
    fn drop(&mut self) {
        self.stop();
    }
}

async fn bind_with_fallback(
    preferred_port: u16,
    fallback_start: u16,
) -> Result<(TcpListener, u16, bool), String> {
    if preferred_port == 0 {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| format!("Failed to bind ephemeral proxy port: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("Failed to read bound port: {e}"))?
            .port();
        return Ok((listener, port, false));
    }

    if let Ok(listener) = TcpListener::bind(("127.0.0.1", preferred_port)).await {
        return Ok((listener, preferred_port, false));
    }

    let start = fallback_start.max(1024);
    let end = start.saturating_add(100);
    for port in start..=end {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)).await {
            return Ok((listener, port, true));
        }
    }

    Err(format!(
        "Failed to bind reverse proxy on port {preferred_port} or fallback range {start}-{end}"
    ))
}

async fn handle_client_connection(
    mut client: TcpStream,
    routes: Arc<RwLock<HashMap<String, ProxyRoute>>>,
) -> std::io::Result<()> {
    let mut buf = Vec::with_capacity(4096);
    let mut tmp = [0u8; 4096];
    let header_end = loop {
        if buf.len() >= MAX_HEADER_BYTES {
            write_http_error(
                &mut client,
                "431 Request Header Fields Too Large",
                "Request headers exceeded 64 KB limit.",
            )
            .await?;
            return Ok(());
        }
        let read_res = tokio::time::timeout(HEADER_READ_TIMEOUT, client.read(&mut tmp)).await;
        let n = match read_res {
            Ok(Ok(0)) => return Ok(()),
            Ok(Ok(n)) => n,
            Ok(Err(e)) => return Err(e),
            Err(_) => {
                write_http_error(&mut client, "408 Request Timeout", "Timed out reading headers.")
                    .await?;
                return Ok(());
            }
        };
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_header_end(&buf) {
            break pos;
        }
    };

    let header_bytes = &buf[..header_end];
    let header_str = String::from_utf8_lossy(header_bytes);
    let host_raw = extract_host_header(&header_str);

    let Some(host_raw) = host_raw else {
        write_http_error(
            &mut client,
            "400 Bad Request",
            "Missing Host header for *.localhost reverse proxy.",
        )
        .await?;
        return Ok(());
    };

    let host_clean = normalize_host_header(&host_raw);
    let route = {
        let guard = routes.read().expect("proxy routes poisoned");
        guard.get(&host_clean).cloned()
    };

    let Some(route) = route else {
        write_http_error(
            &mut client,
            "404 Not Found",
            &format!("No DevDock service is registered for host '{host_clean}'."),
        )
        .await?;
        return Ok(());
    };

    let upstream_addr = format!("127.0.0.1:{}", route.target_port);
    let upstream_res =
        tokio::time::timeout(UPSTREAM_CONNECT_TIMEOUT, TcpStream::connect(&upstream_addr)).await;
    let mut upstream = match upstream_res {
        Ok(Ok(stream)) => stream,
        Ok(Err(err)) => {
            write_http_error(
                &mut client,
                "502 Bad Gateway",
                &format!(
                    "Service '{}' ({}) on port {} is unreachable: {err}",
                    route.service_name, route.domain, route.target_port
                ),
            )
            .await?;
            return Ok(());
        }
        Err(_) => {
            write_http_error(
                &mut client,
                "502 Bad Gateway",
                &format!(
                    "Timed out connecting to service '{}' on port {}.",
                    route.service_name, route.target_port
                ),
            )
            .await?;
            return Ok(());
        }
    };

    // Inject X-Forwarded-* headers right before `\r\n\r\n` and forward headers + any buffered body in one write
    let mut outbound = inject_forwarded_headers(header_bytes, &host_raw);
    outbound.extend_from_slice(b"\r\n\r\n");
    if header_end + 4 < buf.len() {
        outbound.extend_from_slice(&buf[header_end + 4..]);
    }
    upstream.write_all(&outbound).await?;

    // Full-duplex copy supports standard HTTP responses, streaming/SSE, and WebSocket (HMR) upgrades
    let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
    Ok(())
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn extract_host_header(headers: &str) -> Option<String> {
    for line in headers.split("\r\n").skip(1) {
        if let Some((name, val)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("host") {
                let cleaned = val.trim();
                if !cleaned.is_empty() {
                    return Some(cleaned.to_string());
                }
            }
        }
    }
    None
}

fn normalize_host_header(raw: &str) -> String {
    let trimmed = raw.trim().to_ascii_lowercase();
    let without_port = if let Some(rest) = trimmed.strip_prefix('[') {
        rest.split(']').next().unwrap_or(&trimmed)
    } else {
        trimmed.split(':').next().unwrap_or(&trimmed)
    };
    without_port.trim_end_matches('.').to_string()
}

fn inject_forwarded_headers(header_bytes: &[u8], host_raw: &str) -> Vec<u8> {
    let header_str = String::from_utf8_lossy(header_bytes);
    let has_xf_host = header_str
        .lines()
        .skip(1)
        .any(|l| l.to_ascii_lowercase().starts_with("x-forwarded-host:"));
    let has_xf_proto = header_str
        .lines()
        .skip(1)
        .any(|l| l.to_ascii_lowercase().starts_with("x-forwarded-proto:"));

    let mut out = Vec::with_capacity(header_bytes.len() + 64);
    out.extend_from_slice(header_bytes);
    if !has_xf_host {
        out.extend_from_slice(format!("\r\nX-Forwarded-Host: {host_raw}").as_bytes());
    }
    if !has_xf_proto {
        out.extend_from_slice(b"\r\nX-Forwarded-Proto: http");
    }
    out
}

async fn write_http_error(stream: &mut TcpStream, status: &str, message: &str) -> std::io::Result<()> {
    let body = format!("{status}\n{message}\n");
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(resp.as_bytes()).await?;
    stream.flush().await
}

pub fn service_domain_slug(name: &str) -> String {
    let stripped = name
        .trim()
        .rsplit('/')
        .next()
        .unwrap_or(name)
        .to_ascii_lowercase();

    let mut out = String::with_capacity(stripped.len());
    let mut prev_dash = false;
    for ch in stripped.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "service".to_string()
    } else {
        out
    }
}

pub fn format_local_domain_url(domain: &str, bound_port: u16) -> String {
    if bound_port == 80 {
        format!("http://{domain}")
    } else {
        format!("http://{domain}:{bound_port}")
    }
}

pub fn system_hosts_path() -> PathBuf {
    #[cfg(windows)]
    {
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        PathBuf::from(root)
            .join("System32")
            .join("drivers")
            .join("etc")
            .join("hosts")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/etc/hosts")
    }
}

pub fn build_hosts_managed_block(domains: &[String]) -> String {
    if domains.is_empty() {
        return String::new();
    }
    let mut lines = Vec::with_capacity(domains.len() + 2);
    lines.push(HOSTS_BEGIN_MARKER.to_string());
    for d in domains {
        lines.push(format!("127.0.0.1\t{d}"));
    }
    lines.push(HOSTS_END_MARKER.to_string());
    lines.join("\n")
}

pub fn build_hosts_file_content(existing: &str, domains: &[String]) -> String {
    let mut kept_lines: Vec<String> = Vec::new();
    let mut inside_managed = false;
    for line in existing.lines() {
        let trimmed = line.trim();
        if trimmed == HOSTS_BEGIN_MARKER {
            inside_managed = true;
            continue;
        }
        if trimmed == HOSTS_END_MARKER {
            inside_managed = false;
            continue;
        }
        if !inside_managed {
            kept_lines.push(line.to_string());
        }
    }

    while kept_lines.last().map(|l| l.trim().is_empty()).unwrap_or(false) {
        kept_lines.pop();
    }

    let block = build_hosts_managed_block(domains);
    if !block.is_empty() {
        if !kept_lines.is_empty() {
            kept_lines.push(String::new());
        }
        kept_lines.push(block);
    }

    let mut result = kept_lines.join("\n");
    if !result.ends_with('\n') {
        result.push('\n');
    }
    result
}

pub fn preview_hosts_sync_at(hosts_path: &Path, domains: &[String]) -> CoreResult<HostsSyncPreview> {
    let existing = std::fs::read_to_string(hosts_path).unwrap_or_default();
    let managed_block = build_hosts_managed_block(domains);
    let updated = build_hosts_file_content(&existing, domains);
    let already_synced = normalize_line_endings(&existing) == normalize_line_endings(&updated);

    Ok(HostsSyncPreview {
        hosts_path: hosts_path.to_string_lossy().to_string(),
        domains: domains.to_vec(),
        already_synced,
        managed_block,
    })
}

fn normalize_line_endings(s: &str) -> String {
    s.replace("\r\n", "\n")
}

pub fn sync_hosts_file_elevated(domains: &[String]) -> CoreResult<HostsSyncResult> {
    let hosts_path = system_hosts_path();
    let existing = std::fs::read_to_string(&hosts_path).unwrap_or_default();
    let updated = build_hosts_file_content(&existing, domains);

    // If writable directly without elevation (e.g. root or permissive permissions), write directly
    if std::fs::write(&hosts_path, &updated).is_ok() {
        return Ok(HostsSyncResult {
            hosts_path: hosts_path.to_string_lossy().to_string(),
            domains_written: domains.len(),
        });
    }

    let temp_path = std::env::temp_dir().join(format!("devdock-hosts-{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temp_path, &updated)?;

    #[cfg(target_os = "macos")]
    {
        let temp_escaped = temp_path
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let hosts_escaped = hosts_path
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let shell_cmd = format!("cp \\\"{temp_escaped}\\\" \\\"{hosts_escaped}\\\"");
        let osa_script = format!("do shell script \"{shell_cmd}\" with administrator privileges");

        let output = std::process::Command::new("osascript")
            .args(["-e", &osa_script])
            .output();
        let _ = std::fs::remove_file(&temp_path);

        let out = output?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(CoreError::Adapter(format!(
                "Gagal memperbarui /etc/hosts: {stderr}"
            )));
        }
    }

    #[cfg(windows)]
    {
        let temp_escaped = temp_path.to_string_lossy().replace('\'', "''");
        let hosts_escaped = hosts_path.to_string_lossy().replace('\'', "''");
        let ps_cmd = format!(
            "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c copy /Y \"{temp_escaped}\" \"{hosts_escaped}\"' -Verb RunAs -Wait"
        );
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_cmd])
            .output();
        let _ = std::fs::remove_file(&temp_path);

        let out = output?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(CoreError::Adapter(format!(
                "Failed to update hosts file with administrator prompt: {stderr}"
            )));
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let status = std::process::Command::new("pkexec")
            .args([
                "cp",
                &temp_path.to_string_lossy(),
                &hosts_path.to_string_lossy(),
            ])
            .status();
        let _ = std::fs::remove_file(&temp_path);
        match status {
            Ok(s) if s.success() => {}
            Ok(s) => {
                return Err(CoreError::Adapter(format!(
                    "pkexec exited with status {s} while updating /etc/hosts"
                )));
            }
            Err(err) => return Err(CoreError::Io(err)),
        }
    }

    Ok(HostsSyncResult {
        hosts_path: hosts_path.to_string_lossy().to_string(),
        domains_written: domains.len(),
    })
}

pub fn open_url_in_browser(url: &str) -> CoreResult<()> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(CoreError::Validation(format!(
            "Invalid URL scheme (expected http:// or https://): {trimmed}"
        )));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(CoreError::Io)?;
    }
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .spawn()
            .map_err(CoreError::Io)?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(CoreError::Io)?;
    }
    Ok(())
}
