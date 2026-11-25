use crate::models::{
    MetricPoint, MetricsSnapshot, ProcessInfo, ProcessMetricSeries, ProjectMetricSeries,
    ServiceMetricSeries,
};
use chrono::Utc;
use std::collections::{HashMap, HashSet, VecDeque};
#[cfg(not(target_os = "macos"))]
use std::process::{Command, Stdio};
use std::sync::RwLock;
use std::time::Duration;

pub const DEFAULT_MONITOR_INTERVAL: Duration = Duration::from_secs(2);
pub const DEFAULT_METRIC_RETENTION: Duration = Duration::from_secs(15 * 60);
pub const DEFAULT_METRIC_MAX_POINTS: usize = 450; // 15m / 2s

#[derive(Debug, Clone, Copy)]
pub struct OsProcessStat {
    pub pid: u32,
    pub ppid: u32,
    pub pgid: u32,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
}

struct MonitorState {
    global_history: VecDeque<MetricPoint>,
    process_history: HashMap<String, VecDeque<MetricPoint>>,
    service_history: HashMap<String, VecDeque<MetricPoint>>,
    project_history: HashMap<String, VecDeque<MetricPoint>>,
    last_snapshot: Option<MetricsSnapshot>,
}

pub struct ResourceMonitor {
    retention: Duration,
    max_points: usize,
    state: RwLock<MonitorState>,
}

impl Default for ResourceMonitor {
    fn default() -> Self {
        Self::new(DEFAULT_METRIC_RETENTION, DEFAULT_METRIC_MAX_POINTS)
    }
}

impl ResourceMonitor {
    pub fn new(retention: Duration, max_points: usize) -> Self {
        Self {
            retention,
            max_points: max_points.max(1),
            state: RwLock::new(MonitorState {
                global_history: VecDeque::with_capacity(max_points.min(512)),
                process_history: HashMap::new(),
                service_history: HashMap::new(),
                project_history: HashMap::new(),
                last_snapshot: None,
            }),
        }
    }

    pub fn last_snapshot(&self) -> Option<MetricsSnapshot> {
        self.state
            .read()
            .expect("monitor lock poisoned")
            .last_snapshot
            .clone()
    }

    pub fn sample_now(&self, processes: &[ProcessInfo]) -> MetricsSnapshot {
        let now_ms = Utc::now().timestamp_millis();
        let os_stats = collect_os_process_stats();
        self.sample_with_stats(processes, &os_stats, now_ms)
    }

    /// Samples metrics using an explicit process stat table and timestamp
    /// (also useful for deterministic retention tests).
    pub fn sample_with_stats(
        &self,
        processes: &[ProcessInfo],
        os_stats: &[OsProcessStat],
        timestamp_ms: i64,
    ) -> MetricsSnapshot {
        let stats_by_pid: HashMap<u32, OsProcessStat> =
            os_stats.iter().copied().map(|s| (s.pid, s)).collect();

        let mut children_by_ppid: HashMap<u32, Vec<u32>> = HashMap::new();
        let mut pids_by_pgid: HashMap<u32, Vec<u32>> = HashMap::new();
        for stat in os_stats {
            children_by_ppid.entry(stat.ppid).or_default().push(stat.pid);
            if stat.pgid > 0 {
                pids_by_pgid.entry(stat.pgid).or_default().push(stat.pid);
            }
        }

        let active_procs: Vec<&ProcessInfo> = processes
            .iter()
            .filter(|p| p.status.is_active())
            .collect();

        let mut state = self.state.write().expect("monitor lock poisoned");
        let retention_ms = self.retention.as_millis() as i64;
        let max_points = self.max_points;

        let mut by_process = HashMap::new();
        let mut service_totals: HashMap<String, (String, f32, u64, usize)> = HashMap::new();
        let mut project_totals: HashMap<String, (f32, u64, usize)> = HashMap::new();
        let mut total_cpu = 0.0_f32;
        let mut total_mem = 0_u64;
        let mut total_tree_procs = 0_usize;

        for proc in &active_procs {
            let (cpu, mem, tree_count) = match proc.pid {
                Some(root_pid) => aggregate_process_tree(
                    root_pid,
                    &stats_by_pid,
                    &children_by_ppid,
                    &pids_by_pgid,
                ),
                None => (0.0, 0, 0),
            };

            total_cpu += cpu;
            total_mem = total_mem.saturating_add(mem);
            total_tree_procs += tree_count;

            let point = MetricPoint {
                timestamp_ms,
                cpu_percent: round_one_decimal(cpu),
                memory_bytes: mem,
                process_count: tree_count,
            };

            let hist = state
                .process_history
                .entry(proc.id.clone())
                .or_insert_with(|| VecDeque::with_capacity(64));
            push_bounded(hist, point, retention_ms, max_points);

            by_process.insert(
                proc.id.clone(),
                ProcessMetricSeries {
                    process_id: proc.id.clone(),
                    project_id: proc.project_id.clone(),
                    service_id: proc.service_id.clone(),
                    script: proc.script.clone(),
                    current_cpu_percent: round_one_decimal(cpu),
                    current_memory_bytes: mem,
                    tree_process_count: tree_count,
                    history: hist.iter().cloned().collect(),
                },
            );

            let svc_entry = service_totals
                .entry(proc.service_id.clone())
                .or_insert_with(|| (proc.project_id.clone(), 0.0, 0, 0));
            svc_entry.1 += cpu;
            svc_entry.2 = svc_entry.2.saturating_add(mem);
            svc_entry.3 += tree_count;

            let proj_entry = project_totals
                .entry(proc.project_id.clone())
                .or_insert((0.0, 0, 0));
            proj_entry.0 += cpu;
            proj_entry.1 = proj_entry.1.saturating_add(mem);
            proj_entry.2 += tree_count;
        }

        let mut by_service = HashMap::new();
        for (service_id, (project_id, cpu, mem, tree_count)) in &service_totals {
            let point = MetricPoint {
                timestamp_ms,
                cpu_percent: round_one_decimal(*cpu),
                memory_bytes: *mem,
                process_count: *tree_count,
            };
            let hist = state
                .service_history
                .entry(service_id.clone())
                .or_insert_with(|| VecDeque::with_capacity(64));
            push_bounded(hist, point, retention_ms, max_points);

            by_service.insert(
                service_id.clone(),
                ServiceMetricSeries {
                    service_id: service_id.clone(),
                    project_id: project_id.clone(),
                    current_cpu_percent: round_one_decimal(*cpu),
                    current_memory_bytes: *mem,
                    history: hist.iter().cloned().collect(),
                },
            );
        }

        let mut by_project = HashMap::new();
        for (project_id, (cpu, mem, tree_count)) in &project_totals {
            let point = MetricPoint {
                timestamp_ms,
                cpu_percent: round_one_decimal(*cpu),
                memory_bytes: *mem,
                process_count: *tree_count,
            };
            let hist = state
                .project_history
                .entry(project_id.clone())
                .or_insert_with(|| VecDeque::with_capacity(64));
            push_bounded(hist, point, retention_ms, max_points);

            by_project.insert(
                project_id.clone(),
                ProjectMetricSeries {
                    project_id: project_id.clone(),
                    current_cpu_percent: round_one_decimal(*cpu),
                    current_memory_bytes: *mem,
                    history: hist.iter().cloned().collect(),
                },
            );
        }

        let global_point = MetricPoint {
            timestamp_ms,
            cpu_percent: round_one_decimal(total_cpu),
            memory_bytes: total_mem,
            process_count: total_tree_procs,
        };
        push_bounded(&mut state.global_history, global_point, retention_ms, max_points);

        let snapshot = MetricsSnapshot {
            sampled_at_ms: timestamp_ms,
            total_cpu_percent: round_one_decimal(total_cpu),
            total_memory_bytes: total_mem,
            global_history: state.global_history.iter().cloned().collect(),
            by_process,
            by_service,
            by_project,
        };
        state.last_snapshot = Some(snapshot.clone());
        snapshot
    }
}

fn push_bounded(
    buf: &mut VecDeque<MetricPoint>,
    point: MetricPoint,
    retention_ms: i64,
    max_points: usize,
) {
    let cutoff = point.timestamp_ms.saturating_sub(retention_ms);
    buf.push_back(point);
    while let Some(front) = buf.front() {
        if front.timestamp_ms < cutoff || buf.len() > max_points {
            buf.pop_front();
        } else {
            break;
        }
    }
}

fn round_one_decimal(v: f32) -> f32 {
    (v * 10.0).round() / 10.0
}

fn aggregate_process_tree(
    root_pid: u32,
    stats_by_pid: &HashMap<u32, OsProcessStat>,
    children_by_ppid: &HashMap<u32, Vec<u32>>,
    pids_by_pgid: &HashMap<u32, Vec<u32>>,
) -> (f32, u64, usize) {
    let mut visited: HashSet<u32> = HashSet::new();
    let mut queue: VecDeque<u32> = VecDeque::new();

    if visited.insert(root_pid) {
        queue.push_back(root_pid);
    }

    // Also seed with any process in the same Unix process group (pgid == root_pid)
    if let Some(group_pids) = pids_by_pgid.get(&root_pid) {
        for &pid in group_pids {
            if visited.insert(pid) {
                queue.push_back(pid);
            }
        }
    }

    while let Some(pid) = queue.pop_front() {
        if let Some(children) = children_by_ppid.get(&pid) {
            for &child_pid in children {
                if visited.insert(child_pid) {
                    queue.push_back(child_pid);
                }
            }
        }
    }

    let mut cpu = 0.0_f32;
    let mut mem = 0_u64;
    let mut count = 0_usize;

    for pid in visited {
        if let Some(stat) = stats_by_pid.get(&pid) {
            cpu += stat.cpu_percent;
            mem = mem.saturating_add(stat.memory_bytes);
            count += 1;
        }
    }

    (cpu, mem, count)
}

#[cfg(target_os = "macos")]
pub fn collect_os_process_stats() -> Vec<OsProcessStat> {
    use std::sync::Mutex;
    use std::time::Instant;

    static PREV_CPU: std::sync::OnceLock<Mutex<(Instant, HashMap<u32, u64>)>> =
        std::sync::OnceLock::new();

    extern "C" {
        fn proc_listallpids(buffer: *mut libc::c_void, buffersize: libc::c_int) -> libc::c_int;
        fn proc_pidinfo(
            pid: libc::c_int,
            flavor: libc::c_int,
            arg: u64,
            buffer: *mut libc::c_void,
            buffersize: libc::c_int,
        ) -> libc::c_int;
    }

    let count_hint = unsafe { proc_listallpids(std::ptr::null_mut(), 0) };
    if count_hint <= 0 {
        return Vec::new();
    }

    let capacity = (count_hint as usize) + 64;
    let mut pids: Vec<libc::pid_t> = vec![0; capacity];
    let bytes_len = (pids.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int;
    let actual_count =
        unsafe { proc_listallpids(pids.as_mut_ptr() as *mut libc::c_void, bytes_len) };
    if actual_count <= 0 {
        return Vec::new();
    }
    pids.truncate((actual_count as usize).min(pids.len()));

    let now = Instant::now();
    let prev_lock = PREV_CPU.get_or_init(|| Mutex::new((now, HashMap::new())));
    let mut prev_guard = prev_lock.lock().expect("prev cpu lock poisoned");
    let elapsed_ns = now.duration_since(prev_guard.0).as_nanos() as f64;
    let mut next_cpu_map = HashMap::with_capacity(pids.len());

    let info_size = std::mem::size_of::<libc::proc_taskallinfo>() as libc::c_int;
    let mut stats = Vec::with_capacity(pids.len());

    for pid in pids {
        if pid <= 0 {
            continue;
        }
        let mut info: libc::proc_taskallinfo = unsafe { std::mem::zeroed() };
        let rc = unsafe {
            proc_pidinfo(
                pid,
                libc::PROC_PIDTASKALLINFO,
                0,
                &mut info as *mut _ as *mut libc::c_void,
                info_size,
            )
        };
        if rc != info_size {
            continue;
        }

        let pid_u32 = info.pbsd.pbi_pid;
        let ppid_u32 = info.pbsd.pbi_ppid;
        let pgid_u32 = info.pbsd.pbi_pgid;
        let rss_bytes = info.ptinfo.pti_resident_size;
        let total_cpu_ns = info
            .ptinfo
            .pti_total_user
            .saturating_add(info.ptinfo.pti_total_system);

        let cpu_percent = if elapsed_ns > 1_000_000.0 {
            if let Some(&prev_ns) = prev_guard.1.get(&pid_u32) {
                let delta_ns = total_cpu_ns.saturating_sub(prev_ns) as f64;
                ((delta_ns / elapsed_ns) * 100.0) as f32
            } else {
                0.0
            }
        } else {
            0.0
        };

        next_cpu_map.insert(pid_u32, total_cpu_ns);
        stats.push(OsProcessStat {
            pid: pid_u32,
            ppid: ppid_u32,
            pgid: pgid_u32,
            cpu_percent: cpu_percent.max(0.0),
            memory_bytes: rss_bytes,
        });
    }

    *prev_guard = (now, next_cpu_map);
    stats
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn collect_os_process_stats() -> Vec<OsProcessStat> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,ppid=,pgid=,%cpu=,rss="])
        .stdin(Stdio::null())
        .output();

    let Ok(out) = output else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut stats = Vec::new();
    for line in stdout.lines() {
        let mut parts = line.split_whitespace();
        let (Some(pid_s), Some(ppid_s), Some(pgid_s), Some(cpu_s), Some(rss_s)) = (
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
        ) else {
            continue;
        };
        let (Ok(pid), Ok(ppid), Ok(pgid), Ok(cpu), Ok(rss_kb)) = (
            pid_s.parse::<u32>(),
            ppid_s.parse::<u32>(),
            pgid_s.parse::<u32>(),
            cpu_s.replace(',', ".").parse::<f32>(),
            rss_s.parse::<u64>(),
        ) else {
            continue;
        };
        stats.push(OsProcessStat {
            pid,
            ppid,
            pgid,
            cpu_percent: cpu.max(0.0),
            memory_bytes: rss_kb.saturating_mul(1024),
        });
    }
    stats
}

#[cfg(windows)]
pub fn collect_os_process_stats() -> Vec<OsProcessStat> {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $($_.WorkingSetSize)\" }",
        ])
        .stdin(Stdio::null())
        .output();

    let Ok(out) = output else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut stats = Vec::new();
    for line in stdout.lines() {
        let mut parts = line.split_whitespace();
        let (Some(pid_s), Some(ppid_s), Some(ws_s)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let (Ok(pid), Ok(ppid), Ok(ws)) = (
            pid_s.parse::<u32>(),
            ppid_s.parse::<u32>(),
            ws_s.parse::<u64>(),
        ) else {
            continue;
        };
        stats.push(OsProcessStat {
            pid,
            ppid,
            pgid: 0,
            cpu_percent: 0.0,
            memory_bytes: ws,
        });
    }
    stats
}
