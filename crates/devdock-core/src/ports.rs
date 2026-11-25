use crate::error::{CoreError, CoreResult};
use crate::models::{
    ListeningPortEntry, PackageManager, PortCheckResult, PortInjectionMethod,
    PortInspectorSnapshot, PortOwnerInfo, ProcessInfo, RunCommandSpec, Service,
};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::net::{SocketAddr, TcpListener};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub struct PortManager;

impl PortManager {
    /// Checks whether a local TCP port is free on IPv4 (127.0.0.1) and IPv6 (::1).
    pub fn is_port_available(port: u16) -> bool {
        if port == 0 {
            return false;
        }
        let v4_ok = TcpListener::bind(("127.0.0.1", port)).is_ok();
        if !v4_ok {
            return false;
        }
        match TcpListener::bind(("::1", port)) {
            Ok(_) => true,
            Err(err) => matches!(
                err.kind(),
                std::io::ErrorKind::AddrNotAvailable | std::io::ErrorKind::Unsupported
            ),
        }
    }

    /// Finds the next available port >= `start_port` that is neither in `reserved`
    /// nor currently bound on the local machine.
    pub fn find_next_free_port(start_port: u16, reserved: &HashSet<u16>) -> Option<u16> {
        let start = start_port.max(1024);
        for port in start..=65535 {
            if reserved.contains(&port) {
                continue;
            }
            if Self::is_port_available(port) {
                return Some(port);
            }
        }
        None
    }

    /// Applies the port injection strategy (`env`, `flag`, or `both`) to a `RunCommandSpec`
    /// and runtime `env_map`.
    pub fn apply_port_injection(
        spec: &mut RunCommandSpec,
        env_map: &mut BTreeMap<String, String>,
        pm: &PackageManager,
        port: u16,
        method: PortInjectionMethod,
        flag_name: Option<&str>,
    ) {
        let port_str = port.to_string();
        if matches!(method, PortInjectionMethod::Env | PortInjectionMethod::Both) {
            env_map.insert("PORT".to_string(), port_str.clone());
        }

        if matches!(method, PortInjectionMethod::Flag | PortInjectionMethod::Both) {
            let flag = flag_name.unwrap_or("--port").to_string();
            let already_present = spec
                .args
                .iter()
                .any(|a| a == &flag || a.starts_with(&format!("{flag}=")));
            if !already_present {
                if matches!(pm, PackageManager::Npm) && !spec.args.iter().any(|a| a == "--") {
                    spec.args.push("--".to_string());
                }
                spec.args.push(flag);
                spec.args.push(port_str);
            }
        }
    }

    /// Inspects all active local TCP listening ports on the host, annotating DevDock
    /// ownership and highlighting conflicts with DevDock-assigned service ports.
    pub fn inspect_listening_ports(
        services: &[Service],
        processes: &[ProcessInfo],
    ) -> CoreResult<PortInspectorSnapshot> {
        let raw_entries = list_os_listening_ports()?;

        // Map active DevDock processes by root PID and by process group (Unix)
        let active_procs: Vec<&ProcessInfo> = processes
            .iter()
            .filter(|p| p.status.is_active())
            .collect();

        let mut proc_by_pid: HashMap<u32, &ProcessInfo> = HashMap::new();
        for p in &active_procs {
            if let Some(pid) = p.pid {
                proc_by_pid.insert(pid, *p);
            }
        }

        let mut services_by_port: HashMap<u16, Vec<&Service>> = HashMap::new();
        for svc in services {
            if let Some(port) = svc.port {
                services_by_port.entry(port).or_default().push(svc);
            }
        }

        let mut entries = Vec::new();
        let mut conflict_ports: HashSet<u16> = HashSet::new();

        for raw in raw_entries {
            let matched_proc = find_devdock_owner_for_pid(raw.pid, &proc_by_pid);
            let assigned_services = services_by_port
                .get(&raw.port)
                .cloned()
                .unwrap_or_default();

            let (conflict_service_id, conflict_service_name) =
                if let Some(svc) = assigned_services.first() {
                    let owned_by_same_service = matched_proc
                        .map(|p| p.service_id == svc.id)
                        .unwrap_or(false);
                    if !owned_by_same_service {
                        conflict_ports.insert(raw.port);
                        (Some(svc.id.clone()), Some(svc.name.clone()))
                    } else {
                        (None, None)
                    }
                } else {
                    (None, None)
                };

            let is_conflict = conflict_service_id.is_some();

            entries.push(ListeningPortEntry {
                port: raw.port,
                address: raw.address,
                pid: raw.pid,
                process_name: raw.process_name,
                is_devdock: matched_proc.is_some(),
                devdock_process_id: matched_proc.map(|p| p.id.clone()),
                devdock_service_id: matched_proc.map(|p| p.service_id.clone()),
                devdock_service_name: matched_proc.map(|p| p.service_name.clone()),
                is_conflict,
                conflict_service_id,
                conflict_service_name,
            });
        }

        entries.sort_by(|a, b| {
            b.is_conflict
                .cmp(&a.is_conflict)
                .then_with(|| a.port.cmp(&b.port))
                .then_with(|| a.pid.cmp(&b.pid))
        });

        Ok(PortInspectorSnapshot {
            conflict_count: conflict_ports.len(),
            entries,
        })
    }

    /// Checks whether a specific service's assigned port is free prior to launching a script.
    pub fn check_service_port(
        service: &Service,
        port: u16,
        all_services: &[Service],
        processes: &[ProcessInfo],
    ) -> CoreResult<PortCheckResult> {
        let reserved: HashSet<u16> = all_services
            .iter()
            .filter(|s| s.id != service.id)
            .filter_map(|s| s.port)
            .collect();

        if Self::is_port_available(port) {
            return Ok(PortCheckResult {
                service_id: service.id.clone(),
                port,
                is_available: true,
                owner: None,
                suggested_port: None,
            });
        }

        let snapshot = Self::inspect_listening_ports(all_services, processes)?;
        let owner = snapshot
            .entries
            .into_iter()
            .find(|e| e.port == port)
            .map(|e| PortOwnerInfo {
                pid: e.pid,
                process_name: e.process_name,
                devdock_process_id: e.devdock_process_id,
                devdock_service_id: e.devdock_service_id,
                devdock_service_name: e.devdock_service_name,
            });

        let suggested_port = Self::find_next_free_port(port.saturating_add(1), &reserved);

        Ok(PortCheckResult {
            service_id: service.id.clone(),
            port,
            is_available: false,
            owner,
            suggested_port,
        })
    }

    /// Terminates an OS process by PID (SIGTERM -> SIGKILL on Unix, taskkill on Windows).
    pub fn kill_pid(pid: u32) -> CoreResult<()> {
        if pid == 0 || pid == std::process::id() {
            return Err(CoreError::Validation(format!(
                "Refusing to terminate invalid or self PID {pid}"
            )));
        }

        #[cfg(unix)]
        {
            let pid_i32 = pid as i32;
            let rc = unsafe { libc::kill(pid_i32, libc::SIGTERM) };
            if rc != 0 {
                let err = std::io::Error::last_os_error();
                if err.raw_os_error() == Some(libc::ESRCH) {
                    return Ok(());
                }
                return Err(CoreError::Io(err));
            }

            let deadline = Instant::now() + Duration::from_secs(2);
            while Instant::now() < deadline {
                if !is_unix_pid_alive(pid_i32) {
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(30));
            }

            if is_unix_pid_alive(pid_i32) {
                unsafe {
                    libc::kill(pid_i32, libc::SIGKILL);
                }
                let kill_deadline = Instant::now() + Duration::from_secs(1);
                while Instant::now() < kill_deadline {
                    if !is_unix_pid_alive(pid_i32) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
            }
            Ok(())
        }

        #[cfg(windows)]
        {
            let output = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/F", "/T"])
                .stdin(Stdio::null())
                .output()?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(CoreError::Adapter(format!(
                    "Failed to terminate PID {pid}: {stderr}"
                )));
            }
            Ok(())
        }
    }
}

#[derive(Debug, Clone)]
struct RawListeningPort {
    port: u16,
    address: String,
    pid: u32,
    process_name: String,
}

#[cfg(unix)]
fn is_unix_pid_alive(pid: i32) -> bool {
    unsafe {
        let rc = libc::kill(pid, 0);
        if rc == 0 {
            return true;
        }
        std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
}

fn find_devdock_owner_for_pid<'a>(
    pid: u32,
    proc_by_pid: &HashMap<u32, &'a ProcessInfo>,
) -> Option<&'a ProcessInfo> {
    if let Some(p) = proc_by_pid.get(&pid) {
        return Some(*p);
    }

    // On Unix, DevDock spawns each script in its own process group (pgid == root pid).
    // Check if the listening process's pgid matches any DevDock root pid!
    #[cfg(unix)]
    {
        let pgid = unsafe { libc::getpgid(pid as i32) };
        if pgid > 0 {
            if let Some(p) = proc_by_pid.get(&(pgid as u32)) {
                return Some(*p);
            }
        }
    }

    None
}

#[cfg(unix)]
fn list_os_listening_ports() -> CoreResult<Vec<RawListeningPort>> {
    // `lsof -nP -iTCP -sTCP:LISTEN -F pcn` emits:
    //   p<pid>
    //   c<command>
    //   n<address:port>
    let output = Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"])
        .stdin(Stdio::null())
        .output();

    let Ok(out) = output else {
        return Ok(Vec::new());
    };

    // lsof exits 1 if no matching open files exist; stdout is empty in that case.
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut results = Vec::new();
    let mut seen: HashSet<(u16, u32)> = HashSet::new();

    let mut current_pid: Option<u32> = None;
    let mut current_cmd = String::new();

    for line in stdout.lines() {
        let mut chars = line.chars();
        let Some(tag) = chars.next() else {
            continue;
        };
        let rest = chars.as_str();
        match tag {
            'p' => {
                current_pid = rest.trim().parse::<u32>().ok();
                current_cmd.clear();
            }
            'c' => {
                current_cmd = rest.trim().to_string();
            }
            'n' => {
                let Some(pid) = current_pid else {
                    continue;
                };
                if let Some((addr, port)) = parse_lsof_endpoint(rest.trim()) {
                    if seen.insert((port, pid)) {
                        results.push(RawListeningPort {
                            port,
                            address: addr,
                            pid,
                            process_name: if current_cmd.is_empty() {
                                format!("pid-{pid}")
                            } else {
                                current_cmd.clone()
                            },
                        });
                    }
                }
            }
            _ => {}
        }
    }

    Ok(results)
}

#[cfg(windows)]
fn list_os_listening_ports() -> CoreResult<Vec<RawListeningPort>> {
    let output = Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .stdin(Stdio::null())
        .output();

    let Ok(out) = output else {
        return Ok(Vec::new());
    };

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut results = Vec::new();
    let mut seen: HashSet<(u16, u32)> = HashSet::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 || !parts[3].eq_ignore_ascii_case("LISTENING") {
            continue;
        }
        let Ok(pid) = parts[4].parse::<u32>() else {
            continue;
        };
        if let Some((addr, port)) = parse_lsof_endpoint(parts[1]) {
            if seen.insert((port, pid)) {
                results.push(RawListeningPort {
                    port,
                    address: addr,
                    pid,
                    process_name: format!("pid-{pid}"),
                });
            }
        }
    }

    Ok(results)
}

fn parse_lsof_endpoint(raw: &str) -> Option<(String, u16)> {
    // Formats: `*:3000`, `127.0.0.1:5173`, `[::1]:3000`, `[::]:8080`
    let cleaned = raw.split_whitespace().next().unwrap_or(raw);
    if let Ok(sock) = cleaned.parse::<SocketAddr>() {
        return Some((sock.ip().to_string(), sock.port()));
    }
    let idx = cleaned.rfind(':')?;
    let host = cleaned[..idx].trim_matches(|c| c == '[' || c == ']');
    let port = cleaned[idx + 1..].parse::<u16>().ok()?;
    Some((
        if host.is_empty() {
            "*".to_string()
        } else {
            host.to_string()
        },
        port,
    ))
}
