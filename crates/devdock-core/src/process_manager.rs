use crate::error::{CoreError, CoreResult};
use crate::log_buffer::{
    filter_log_lines, format_log_line_for_export, LogBuffer, DEFAULT_LOG_CAPACITY,
};
use crate::models::{
    CrashNotificationEvent, LogExportScope, LogLine, LogStream, ProcessEvent, ProcessInfo,
    ProcessStatus, RunCommandSpec, Service,
};
use crate::traits::{InMemoryNotifier, Notifier};
use chrono::Utc;
use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

pub const DEFAULT_STOP_GRACE_PERIOD: Duration = Duration::from_secs(5);
pub const DEFAULT_AUTO_RESTART_MAX: u32 = 3;
pub const DEFAULT_AUTO_RESTART_WINDOW: Duration = Duration::from_secs(60);
pub const DEFAULT_AUTO_RESTART_BACKOFF: Duration = Duration::from_millis(300);

#[derive(Debug, Clone, Copy)]
pub struct AutoRestartPolicy {
    pub max_restarts: u32,
    pub window: Duration,
    pub backoff: Duration,
}

impl Default for AutoRestartPolicy {
    fn default() -> Self {
        Self {
            max_restarts: DEFAULT_AUTO_RESTART_MAX,
            window: DEFAULT_AUTO_RESTART_WINDOW,
            backoff: DEFAULT_AUTO_RESTART_BACKOFF,
        }
    }
}

pub type ProcessEventListener = Arc<dyn Fn(ProcessEvent) + Send + Sync>;

#[cfg(unix)]
struct PlatformHandle {
    pgid: i32,
}

#[cfg(windows)]
struct PlatformHandle {
    job_handle: isize,
    pid: u32,
}

#[cfg(windows)]
unsafe impl Send for PlatformHandle {}

#[cfg(windows)]
impl Drop for PlatformHandle {
    fn drop(&mut self) {
        if self.job_handle != 0 {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.job_handle as _);
            }
            self.job_handle = 0;
        }
    }
}

struct ManagedProcess {
    info: RwLock<ProcessInfo>,
    stop_requested: Arc<AtomicBool>,
    logs: Arc<RwLock<LogBuffer>>,
    handle: Mutex<Option<PlatformHandle>>,
}

struct ProcessManagerInner {
    processes: RwLock<HashMap<String, Arc<ManagedProcess>>>,
    seq: AtomicU64,
    log_capacity: usize,
    stop_grace_period: RwLock<Duration>,
    auto_restart_policy: RwLock<AutoRestartPolicy>,
    notifier: Arc<dyn Notifier>,
    listeners: RwLock<Vec<ProcessEventListener>>,
}

impl ProcessManagerInner {
    fn emit(&self, event: ProcessEvent) {
        let listeners = self
            .listeners
            .read()
            .expect("process listeners lock poisoned")
            .clone();
        for listener in listeners {
            listener(event.clone());
        }
    }

    fn next_seq(&self) -> u64 {
        self.seq.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn push_system_log(&self, managed: &Arc<ManagedProcess>, text: String) {
        let (process_id, project_id, service_id, service_name, script) = {
            let info = managed.info.read().expect("info lock poisoned");
            (
                info.id.clone(),
                info.project_id.clone(),
                info.service_id.clone(),
                info.service_name.clone(),
                info.script.clone(),
            )
        };
        let line = LogLine {
            seq: self.next_seq(),
            process_id,
            project_id,
            service_id,
            service_name,
            script,
            stream: LogStream::System,
            text,
            timestamp: Utc::now().to_rfc3339(),
        };
        {
            let mut logs = managed.logs.write().expect("logs lock poisoned");
            logs.push(line.clone());
        }
        self.emit(ProcessEvent::LogLine(line));
    }
}

pub struct ProcessManager {
    inner: Arc<ProcessManagerInner>,
    stop_on_drop: AtomicBool,
}

impl Default for ProcessManager {
    fn default() -> Self {
        Self::new(
            DEFAULT_LOG_CAPACITY,
            DEFAULT_STOP_GRACE_PERIOD,
            Arc::new(InMemoryNotifier::new()),
        )
    }
}

impl ProcessManager {
    pub fn new(
        log_capacity: usize,
        stop_grace_period: Duration,
        notifier: Arc<dyn Notifier>,
    ) -> Self {
        Self {
            inner: Arc::new(ProcessManagerInner {
                processes: RwLock::new(HashMap::new()),
                seq: AtomicU64::new(0),
                log_capacity: log_capacity.max(1),
                stop_grace_period: RwLock::new(stop_grace_period),
                auto_restart_policy: RwLock::new(AutoRestartPolicy::default()),
                notifier,
                listeners: RwLock::new(Vec::new()),
            }),
            stop_on_drop: AtomicBool::new(true),
        }
    }

    pub fn set_stop_on_drop(&self, stop_on_drop: bool) {
        self.stop_on_drop.store(stop_on_drop, Ordering::SeqCst);
    }

    pub fn set_auto_restart_policy(&self, policy: AutoRestartPolicy) {
        *self
            .inner
            .auto_restart_policy
            .write()
            .expect("auto_restart_policy lock poisoned") = policy;
    }

    pub fn auto_restart_policy(&self) -> AutoRestartPolicy {
        *self
            .inner
            .auto_restart_policy
            .read()
            .expect("auto_restart_policy lock poisoned")
    }

    pub fn set_stop_grace_period(&self, duration: Duration) {
        *self
            .inner
            .stop_grace_period
            .write()
            .expect("grace period lock poisoned") = duration;
    }

    pub fn stop_grace_period(&self) -> Duration {
        *self
            .inner
            .stop_grace_period
            .read()
            .expect("grace period lock poisoned")
    }

    pub fn subscribe(&self, listener: ProcessEventListener) {
        self.inner
            .listeners
            .write()
            .expect("process listeners lock poisoned")
            .push(listener);
    }

    pub fn emit_event(&self, event: ProcessEvent) {
        self.inner.emit(event);
    }

    pub fn spawn_script(
        &self,
        service: &Service,
        script: &str,
        spec: &RunCommandSpec,
        env_map: &BTreeMap<String, String>,
        auto_restart: bool,
    ) -> CoreResult<ProcessInfo> {
        let (mut child, pid, platform_handle) = spawn_child_process(spec, env_map)?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let process_id = Uuid::new_v4().to_string();
        let started_at = Utc::now().to_rfc3339();
        let started_instant = Instant::now();
        let command_display = if spec.args.is_empty() {
            spec.program.clone()
        } else {
            format!("{} {}", spec.program, spec.args.join(" "))
        };

        let info = ProcessInfo {
            id: process_id.clone(),
            project_id: service.project_id.clone(),
            service_id: service.id.clone(),
            service_name: service.name.clone(),
            script: script.to_string(),
            command: command_display,
            pid: Some(pid),
            status: ProcessStatus::Running,
            exit_code: None,
            started_at,
            finished_at: None,
            duration_ms: None,
            line_count: 0,
            auto_restart,
            restart_count: 0,
            crash_reason: None,
            last_error_snippet: None,
        };

        let managed = Arc::new(ManagedProcess {
            info: RwLock::new(info.clone()),
            stop_requested: Arc::new(AtomicBool::new(false)),
            logs: Arc::new(RwLock::new(LogBuffer::new(self.inner.log_capacity))),
            handle: Mutex::new(Some(platform_handle)),
        });

        self.inner
            .processes
            .write()
            .expect("processes lock poisoned")
            .insert(process_id.clone(), Arc::clone(&managed));

        self.inner.emit(ProcessEvent::StatusChanged(info.clone()));

        let initial_stdout = stdout.map(|pipe| {
            spawn_stream_reader(
                pipe,
                LogStream::Stdout,
                Arc::clone(&self.inner),
                Arc::clone(&managed),
            )
        });
        let initial_stderr = stderr.map(|pipe| {
            spawn_stream_reader(
                pipe,
                LogStream::Stderr,
                Arc::clone(&self.inner),
                Arc::clone(&managed),
            )
        });

        let inner_wait = Arc::clone(&self.inner);
        let managed_wait = Arc::clone(&managed);
        let restart_spec = spec.clone();
        let restart_env = env_map.clone();

        thread::Builder::new()
            .name(format!("devdock-wait-{}", &process_id[..8]))
            .spawn(move || {
                let mut current_child = child;
                let mut current_stdout = initial_stdout;
                let mut current_stderr = initial_stderr;
                let mut current_started = started_instant;
                let mut restart_timestamps: Vec<Instant> = Vec::new();

                loop {
                    let exit_status = current_child.wait();

                    // Drain readers so trailing output is never dropped before final status event
                    if let Some(h) = current_stdout.take() {
                        let _ = h.join();
                    }
                    if let Some(h) = current_stderr.take() {
                        let _ = h.join();
                    }

                    let exit_code = exit_status.ok().and_then(|s| s.code());
                    let duration_ms = current_started.elapsed().as_millis() as u64;
                    let was_stopped = managed_wait.stop_requested.load(Ordering::SeqCst);

                    // Release platform handle on Windows after child exits
                    #[cfg(windows)]
                    {
                        if let Ok(mut h) = managed_wait.handle.lock() {
                            *h = None;
                        }
                    }

                    // Normal exit or user-initiated stop -> finish as Stopped
                    if was_stopped || exit_code == Some(0) {
                        let finished_at = Utc::now().to_rfc3339();
                        let updated = {
                            let mut guard =
                                managed_wait.info.write().expect("info lock poisoned");
                            guard.status = ProcessStatus::Stopped;
                            guard.exit_code = exit_code;
                            guard.finished_at = Some(finished_at);
                            guard.duration_ms = Some(duration_ms);
                            guard.line_count =
                                managed_wait.logs.read().expect("logs lock poisoned").len();
                            guard.clone()
                        };
                        inner_wait.emit(ProcessEvent::StatusChanged(updated));
                        break;
                    }

                    // Unexpected non-zero exit -> check auto-restart policy
                    let last_error_snippet = extract_last_error_snippet(&managed_wait);
                    let policy = *inner_wait
                        .auto_restart_policy
                        .read()
                        .expect("auto_restart_policy lock poisoned");

                    if auto_restart {
                        let now = Instant::now();
                        restart_timestamps.retain(|t| now.duration_since(*t) <= policy.window);

                        if (restart_timestamps.len() as u32) < policy.max_restarts {
                            restart_timestamps.push(now);
                            let attempt = restart_timestamps.len() as u32;

                            let restarting_snapshot = {
                                let mut guard =
                                    managed_wait.info.write().expect("info lock poisoned");
                                guard.status = ProcessStatus::Restarting;
                                guard.exit_code = exit_code;
                                guard.restart_count = guard.restart_count.saturating_add(1);
                                guard.last_error_snippet = last_error_snippet.clone();
                                guard.line_count =
                                    managed_wait.logs.read().expect("logs lock poisoned").len();
                                guard.clone()
                            };
                            inner_wait.push_system_log(
                                &managed_wait,
                                format!(
                                    "[DevDock] Process exited (code {}). Auto-restarting ({attempt}/{})…",
                                    exit_code
                                        .map(|c| c.to_string())
                                        .unwrap_or_else(|| "signal".to_string()),
                                    policy.max_restarts
                                ),
                            );
                            inner_wait.emit(ProcessEvent::StatusChanged(restarting_snapshot));

                            // Interruptible backoff sleep
                            let backoff_deadline = Instant::now() + policy.backoff;
                            while Instant::now() < backoff_deadline {
                                if managed_wait.stop_requested.load(Ordering::SeqCst) {
                                    break;
                                }
                                thread::sleep(Duration::from_millis(20));
                            }

                            if managed_wait.stop_requested.load(Ordering::SeqCst) {
                                let finished_at = Utc::now().to_rfc3339();
                                let updated = {
                                    let mut guard =
                                        managed_wait.info.write().expect("info lock poisoned");
                                    guard.status = ProcessStatus::Stopped;
                                    guard.finished_at = Some(finished_at);
                                    guard.duration_ms = Some(duration_ms);
                                    guard.clone()
                                };
                                inner_wait.emit(ProcessEvent::StatusChanged(updated));
                                break;
                            }

                            match spawn_child_process(&restart_spec, &restart_env) {
                                Ok((mut next_child, next_pid, next_handle)) => {
                                    let next_out = next_child.stdout.take();
                                    let next_err = next_child.stderr.take();
                                    {
                                        let mut h =
                                            managed_wait.handle.lock().expect("handle lock poisoned");
                                        *h = Some(next_handle);
                                    }
                                    current_started = Instant::now();
                                    let running_snapshot = {
                                        let mut guard = managed_wait
                                            .info
                                            .write()
                                            .expect("info lock poisoned");
                                        guard.pid = Some(next_pid);
                                        guard.status = ProcessStatus::Running;
                                        guard.exit_code = None;
                                        guard.finished_at = None;
                                        guard.line_count = managed_wait
                                            .logs
                                            .read()
                                            .expect("logs lock poisoned")
                                            .len();
                                        guard.clone()
                                    };
                                    inner_wait.emit(ProcessEvent::StatusChanged(running_snapshot));

                                    current_stdout = next_out.map(|pipe| {
                                        spawn_stream_reader(
                                            pipe,
                                            LogStream::Stdout,
                                            Arc::clone(&inner_wait),
                                            Arc::clone(&managed_wait),
                                        )
                                    });
                                    current_stderr = next_err.map(|pipe| {
                                        spawn_stream_reader(
                                            pipe,
                                            LogStream::Stderr,
                                            Arc::clone(&inner_wait),
                                            Arc::clone(&managed_wait),
                                        )
                                    });
                                    current_child = next_child;
                                    continue;
                                }
                                Err(spawn_err) => {
                                    let reason = format!(
                                        "Auto-restart failed: {spawn_err}"
                                    );
                                    finalize_crash(
                                        &inner_wait,
                                        &managed_wait,
                                        exit_code,
                                        duration_ms,
                                        reason,
                                        last_error_snippet,
                                        true,
                                    );
                                    break;
                                }
                            }
                        } else {
                            let reason = format!(
                                "Auto-restart stopped: exceeded {} crashes within {}s",
                                policy.max_restarts,
                                policy.window.as_secs()
                            );
                            inner_wait.push_system_log(
                                &managed_wait,
                                format!("[DevDock] {reason}"),
                            );
                            finalize_crash(
                                &inner_wait,
                                &managed_wait,
                                exit_code,
                                duration_ms,
                                reason,
                                last_error_snippet,
                                true,
                            );
                            break;
                        }
                    } else {
                        let reason = format!(
                            "Process exited unexpectedly (exit code {})",
                            exit_code
                                .map(|c| c.to_string())
                                .unwrap_or_else(|| "unknown".to_string())
                        );
                        finalize_crash(
                            &inner_wait,
                            &managed_wait,
                            exit_code,
                            duration_ms,
                            reason,
                            last_error_snippet,
                            false,
                        );
                        break;
                    }
                }
            })
            .map_err(CoreError::Io)?;

        Ok(info)
    }

    pub fn list_processes(&self) -> Vec<ProcessInfo> {
        let mut list: Vec<ProcessInfo> = self
            .inner
            .processes
            .read()
            .expect("processes lock poisoned")
            .values()
            .map(|p| {
                let mut info = p.info.read().expect("info lock poisoned").clone();
                info.line_count = p.logs.read().expect("logs lock poisoned").len();
                info
            })
            .collect();
        list.sort_by(|a, b| a.started_at.cmp(&b.started_at));
        list
    }

    pub fn get_process(&self, process_id: &str) -> CoreResult<ProcessInfo> {
        let managed = self.find_managed(process_id)?;
        let mut info = managed.info.read().expect("info lock poisoned").clone();
        info.line_count = managed.logs.read().expect("logs lock poisoned").len();
        Ok(info)
    }

    pub fn stop_process(&self, process_id: &str) -> CoreResult<ProcessInfo> {
        let grace = self.stop_grace_period();
        self.stop_process_with_grace(process_id, grace)
    }

    pub fn stop_process_with_grace(
        &self,
        process_id: &str,
        grace_period: Duration,
    ) -> CoreResult<ProcessInfo> {
        let managed = self.find_managed(process_id)?;
        managed.stop_requested.store(true, Ordering::SeqCst);

        let already_done = {
            let mut guard = managed.info.write().expect("info lock poisoned");
            if !guard.status.is_active() {
                true
            } else {
                guard.status = ProcessStatus::Stopping;
                let snapshot = guard.clone();
                drop(guard);
                self.inner.emit(ProcessEvent::StatusChanged(snapshot));
                false
            }
        };

        if already_done {
            return self.get_process(process_id);
        }

        #[cfg(unix)]
        {
            let pgid = managed
                .handle
                .lock()
                .expect("handle lock poisoned")
                .as_ref()
                .map(|h| h.pgid);

            if let Some(pgid) = pgid {
                // 1. Send graceful SIGTERM to entire process group (-pgid)
                unsafe {
                    libc::kill(-pgid, libc::SIGTERM);
                }

                let deadline = Instant::now() + grace_period;
                while Instant::now() < deadline {
                    let main_exited = !managed
                        .info
                        .read()
                        .expect("info lock poisoned")
                        .status
                        .is_active();
                    let group_alive = is_unix_pgid_alive(pgid);
                    if main_exited && !group_alive {
                        break;
                    }
                    thread::sleep(Duration::from_millis(25));
                }

                // 2. Escalate to SIGKILL for the entire process group if anything is still alive
                let still_active = managed
                    .info
                    .read()
                    .expect("info lock poisoned")
                    .status
                    .is_active();
                if still_active || is_unix_pgid_alive(pgid) {
                    unsafe {
                        libc::kill(-pgid, libc::SIGKILL);
                    }
                    let kill_deadline = Instant::now() + Duration::from_secs(2);
                    while Instant::now() < kill_deadline {
                        let main_exited = !managed
                            .info
                            .read()
                            .expect("info lock poisoned")
                            .status
                            .is_active();
                        if main_exited && !is_unix_pgid_alive(pgid) {
                            break;
                        }
                        thread::sleep(Duration::from_millis(20));
                    }
                }
            }
        }

        #[cfg(windows)]
        {
            // Terminate the entire Windows Job Object (process tree)
            if let Ok(mut guard) = managed.handle.lock() {
                if let Some(handle) = guard.take() {
                    if handle.job_handle != 0 {
                        unsafe {
                            windows_sys::Win32::System::JobObjects::TerminateJobObject(
                                handle.job_handle as _,
                                1,
                            );
                        }
                    }
                    drop(handle);
                }
            }
            let deadline = Instant::now() + grace_period.min(Duration::from_secs(2));
            while Instant::now() < deadline {
                if !managed
                    .info
                    .read()
                    .expect("info lock poisoned")
                    .status
                    .is_active()
                {
                    break;
                }
                thread::sleep(Duration::from_millis(25));
            }
        }

        self.get_process(process_id)
    }

    pub fn stop_all_processes(&self) {
        let active_ids: Vec<String> = self
            .list_processes()
            .into_iter()
            .filter(|p| p.status.is_active())
            .map(|p| p.id)
            .collect();
        for id in active_ids {
            let _ = self.stop_process(&id);
        }
    }

    pub fn get_process_logs(
        &self,
        process_id: &str,
        filter: Option<&str>,
        stderr_only: bool,
    ) -> CoreResult<Vec<LogLine>> {
        let managed = self.find_managed(process_id)?;
        let logs = managed.logs.read().expect("logs lock poisoned");
        Ok(logs.filtered(filter, stderr_only))
    }

    pub fn get_project_logs(
        &self,
        project_id: &str,
        filter: Option<&str>,
        stderr_only: bool,
    ) -> Vec<LogLine> {
        let procs: Vec<Arc<ManagedProcess>> = self
            .inner
            .processes
            .read()
            .expect("processes lock poisoned")
            .values()
            .filter(|p| p.info.read().expect("info lock poisoned").project_id == project_id)
            .cloned()
            .collect();

        merge_logs(&procs, filter, stderr_only)
    }

    pub fn get_all_logs(&self, filter: Option<&str>, stderr_only: bool) -> Vec<LogLine> {
        let procs: Vec<Arc<ManagedProcess>> = self
            .inner
            .processes
            .read()
            .expect("processes lock poisoned")
            .values()
            .cloned()
            .collect();

        merge_logs(&procs, filter, stderr_only)
    }

    pub fn clear_process_logs(&self, process_id: &str) -> CoreResult<()> {
        let managed = self.find_managed(process_id)?;
        managed.logs.write().expect("logs lock poisoned").clear();
        {
            let mut info = managed.info.write().expect("info lock poisoned");
            info.line_count = 0;
        }
        self.inner.emit(ProcessEvent::LogsCleared {
            process_id: process_id.to_string(),
        });
        Ok(())
    }

    pub fn clear_project_logs(&self, project_id: &str) {
        let ids: Vec<String> = self
            .inner
            .processes
            .read()
            .expect("processes lock poisoned")
            .iter()
            .filter_map(|(id, p)| {
                if p.info.read().expect("info lock poisoned").project_id == project_id {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect();

        for id in ids {
            let _ = self.clear_process_logs(&id);
        }
    }

    pub fn export_logs_to_file(
        &self,
        scope: &LogExportScope,
        path: &Path,
        filter: Option<&str>,
        stderr_only: bool,
        strip_ansi: bool,
    ) -> CoreResult<usize> {
        let (lines, include_service_tag) = match scope {
            LogExportScope::Process(pid) => (self.get_process_logs(pid, filter, stderr_only)?, false),
            LogExportScope::Project(proj_id) => {
                (self.get_project_logs(proj_id, filter, stderr_only), true)
            }
            LogExportScope::All => (self.get_all_logs(filter, stderr_only), true),
        };

        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }

        let mut file = std::fs::File::create(path)?;
        for line in &lines {
            let formatted = format_log_line_for_export(line, include_service_tag, strip_ansi);
            writeln!(file, "{formatted}")?;
        }
        file.flush()?;
        Ok(lines.len())
    }

    fn find_managed(&self, process_id: &str) -> CoreResult<Arc<ManagedProcess>> {
        self.inner
            .processes
            .read()
            .expect("processes lock poisoned")
            .get(process_id)
            .cloned()
            .ok_or_else(|| CoreError::NotFound(format!("Process '{process_id}' not found")))
    }
}

impl Drop for ProcessManager {
    fn drop(&mut self) {
        if self.stop_on_drop.load(Ordering::SeqCst) {
            self.stop_all_processes();
        }
    }
}

fn spawn_child_process(
    spec: &RunCommandSpec,
    env_map: &BTreeMap<String, String>,
) -> CoreResult<(std::process::Child, u32, PlatformHandle)> {
    let cwd = Path::new(&spec.cwd);
    if !cwd.is_dir() {
        return Err(CoreError::InvalidFolder(format!(
            "Service folder does not exist: {}",
            spec.cwd
        )));
    }

    let path_env = env_map.get("PATH").map(String::as_str).unwrap_or("");
    let resolved_program = resolve_program_in_path(&spec.program, path_env);

    let mut cmd = Command::new(&resolved_program);
    cmd.args(&spec.args)
        .current_dir(cwd)
        .env_clear()
        .envs(env_map)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        // Preserve essential Windows system environment variables after env_clear()
        // so .cmd/.bat wrappers (npm.cmd, pnpm.cmd) and node.exe can locate cmd.exe and temp dirs.
        for key in [
            "SYSTEMROOT",
            "COMSPEC",
            "WINDIR",
            "PATHEXT",
            "TEMP",
            "TMP",
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
        ] {
            let already_set = env_map.keys().any(|k| k.eq_ignore_ascii_case(key));
            if !already_set {
                if let Ok(val) = std::env::var(key) {
                    cmd.env(key, val);
                }
            }
        }
    }

    // Preserve ANSI colors for Node/Vite/Next/chalk when piped
    if !env_map.contains_key("FORCE_COLOR") && !env_map.contains_key("NO_COLOR") {
        cmd.env("FORCE_COLOR", "1");
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Create a new process group with pgid == child pid so stop terminates the entire tree
        cmd.process_group(0);
    }

    let child = cmd.spawn().map_err(|e| {
        CoreError::Adapter(format!(
            "Failed to spawn '{} {}' in {}: {}",
            spec.program,
            spec.args.join(" "),
            spec.cwd,
            e
        ))
    })?;

    let pid = child.id();

    #[cfg(unix)]
    let platform_handle = PlatformHandle { pgid: pid as i32 };

    #[cfg(windows)]
    let platform_handle = create_windows_job_for_child(&child, pid)?;

    Ok((child, pid, platform_handle))
}

fn extract_last_error_snippet(managed: &Arc<ManagedProcess>) -> Option<String> {
    let logs = managed.logs.read().expect("logs lock poisoned");
    let lines = logs.all_lines();
    // Prefer last non-empty stderr line, fall back to last non-empty stdout line
    let stderr_line = lines
        .iter()
        .rev()
        .find(|l| l.stream == LogStream::Stderr && !l.text.trim().is_empty())
        .map(|l| l.text.trim().to_string());
    if stderr_line.is_some() {
        return stderr_line;
    }
    lines
        .iter()
        .rev()
        .find(|l| l.stream == LogStream::Stdout && !l.text.trim().is_empty())
        .map(|l| l.text.trim().to_string())
}

fn finalize_crash(
    inner: &Arc<ProcessManagerInner>,
    managed: &Arc<ManagedProcess>,
    exit_code: Option<i32>,
    duration_ms: u64,
    reason: String,
    last_error_snippet: Option<String>,
    auto_restart_exhausted: bool,
) {
    let finished_at = Utc::now().to_rfc3339();
    let updated = {
        let mut guard = managed.info.write().expect("info lock poisoned");
        guard.status = ProcessStatus::Crashed;
        guard.exit_code = exit_code;
        guard.finished_at = Some(finished_at);
        guard.duration_ms = Some(duration_ms);
        guard.crash_reason = Some(reason.clone());
        guard.last_error_snippet = last_error_snippet.clone();
        guard.line_count = managed.logs.read().expect("logs lock poisoned").len();
        guard.clone()
    };

    inner.emit(ProcessEvent::StatusChanged(updated.clone()));

    let title = format!("{} · {} crashed", updated.service_name, updated.script);
    let body = match &last_error_snippet {
        Some(snippet) => format!("{reason} — {snippet}"),
        None => reason.clone(),
    };
    let _ = inner.notifier.notify(&title, &body);

    inner.emit(ProcessEvent::CrashNotification(CrashNotificationEvent {
        process_id: updated.id,
        project_id: updated.project_id,
        service_id: updated.service_id,
        service_name: updated.service_name,
        script: updated.script,
        exit_code,
        reason,
        last_error_snippet,
        auto_restart_exhausted,
    }));
}

fn merge_logs(
    procs: &[Arc<ManagedProcess>],
    filter: Option<&str>,
    stderr_only: bool,
) -> Vec<LogLine> {
    let mut combined = Vec::new();
    for p in procs {
        let guard = p.logs.read().expect("logs lock poisoned");
        combined.extend(guard.all_lines());
    }
    combined.sort_by_key(|line| line.seq);
    filter_log_lines(combined.iter(), filter, stderr_only)
}

fn spawn_stream_reader<R: std::io::Read + Send + 'static>(
    pipe: R,
    stream: LogStream,
    inner: Arc<ProcessManagerInner>,
    managed: Arc<ManagedProcess>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut reader = BufReader::new(pipe);
        let mut buf = Vec::with_capacity(512);

        let (process_id, project_id, service_id, service_name, script) = {
            let info = managed.info.read().expect("info lock poisoned");
            (
                info.id.clone(),
                info.project_id.clone(),
                info.service_id.clone(),
                info.service_name.clone(),
                info.script.clone(),
            )
        };

        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break,
                Ok(_) => {
                    while matches!(buf.last(), Some(b'\n' | b'\r')) {
                        buf.pop();
                    }
                    let text = String::from_utf8_lossy(&buf).into_owned();
                    let line = LogLine {
                        seq: inner.next_seq(),
                        process_id: process_id.clone(),
                        project_id: project_id.clone(),
                        service_id: service_id.clone(),
                        service_name: service_name.clone(),
                        script: script.clone(),
                        stream,
                        text,
                        timestamp: Utc::now().to_rfc3339(),
                    };

                    {
                        let mut logs = managed.logs.write().expect("logs lock poisoned");
                        logs.push(line.clone());
                    }
                    inner.emit(ProcessEvent::LogLine(line));
                }
                Err(_) => break,
            }
        }
    })
}

/// Resolves an executable name (like `pnpm` or `npm`) against the provided `PATH` string
/// so GUI-launched processes find binaries from the user's login shell PATH.
pub fn resolve_program_in_path(program: &str, path_env: &str) -> PathBuf {
    let candidate = Path::new(program);
    if candidate.is_absolute() || program.contains(std::path::MAIN_SEPARATOR) {
        return candidate.to_path_buf();
    }

    for dir in std::env::split_paths(path_env) {
        #[cfg(windows)]
        {
            // On Windows, Node/npm/pnpm install extensionless POSIX shims alongside `.cmd`/`.exe`
            // (e.g. `nodejs\npm` + `nodejs\npm.cmd`). Prefer Windows executable extensions so we
            // don't accidentally pick the extensionless shell script and fail with ERROR_BAD_EXE_FORMAT.
            let exts: &[&str] = if Path::new(program).extension().is_some() {
                &[""]
            } else {
                &[".exe", ".cmd", ".bat", ".com"]
            };
            for ext in exts {
                let full = dir.join(format!("{program}{ext}"));
                if full.is_file() {
                    return full;
                }
            }
        }

        #[cfg(not(windows))]
        {
            let full = dir.join(program);
            if full.is_file() && is_executable_unix(&full) {
                return full;
            }
        }
    }

    PathBuf::from(program)
}

#[cfg(unix)]
fn is_executable_unix(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(unix)]
fn is_unix_pgid_alive(pgid: i32) -> bool {
    unsafe {
        let rc = libc::kill(-pgid, 0);
        if rc == 0 {
            return true;
        }
        let err = std::io::Error::last_os_error();
        // EPERM means at least one process exists in the group (owned by another user)
        err.raw_os_error() == Some(libc::EPERM)
    }
}

#[cfg(windows)]
fn create_windows_job_for_child(
    child: &std::process::Child,
    pid: u32,
) -> CoreResult<PlatformHandle> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Ok(PlatformHandle { job_handle: 0, pid });
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        AssignProcessToJobObject(job, child.as_raw_handle() as _);
        Ok(PlatformHandle {
            job_handle: job as isize,
            pid,
        })
    }
}
