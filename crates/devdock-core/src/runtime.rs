use crate::error::{CoreError, CoreResult};
use crate::models::{
    NodeInstallProgress, NodeInstallResult, NodeRuntimeStatus, NodeVersionSource, Service,
    ServiceNodeRuntime,
};
use crate::process_manager::resolve_program_in_path;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;

/// Pluggable version-manager contract (fnm first; nvm/volta/mise can be added later).
pub trait VersionManager: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn is_available(&self, path_env: &str) -> bool;
    fn list_installed(&self, path_env: &str) -> CoreResult<Vec<String>>;
    fn resolve_bin_dir(
        &self,
        version: &str,
        path_env: &str,
        cwd: &Path,
    ) -> CoreResult<Option<PathBuf>>;
    fn install_version(
        &self,
        version: &str,
        path_env: &str,
        on_line: &mut dyn FnMut(String),
    ) -> CoreResult<String>;
}

#[derive(Debug, Default)]
pub struct FnmVersionManager;

impl FnmVersionManager {
    pub fn new() -> Self {
        Self
    }

    fn find_fnm(path_env: &str) -> Option<PathBuf> {
        let resolved = resolve_program_in_path("fnm", path_env);
        if resolved.is_file() {
            Some(resolved)
        } else {
            None
        }
    }

    fn command_with_path(bin: &Path, path_env: &str) -> Command {
        let mut cmd = Command::new(bin);
        if !path_env.is_empty() {
            cmd.env("PATH", path_env);
        }
        cmd
    }
}

impl VersionManager for FnmVersionManager {
    fn id(&self) -> &'static str {
        "fnm"
    }

    fn display_name(&self) -> &'static str {
        "fnm"
    }

    fn is_available(&self, path_env: &str) -> bool {
        Self::find_fnm(path_env).is_some()
    }

    fn list_installed(&self, path_env: &str) -> CoreResult<Vec<String>> {
        let Some(fnm_bin) = Self::find_fnm(path_env) else {
            return Ok(Vec::new());
        };

        let output = Self::command_with_path(&fnm_bin, path_env)
            .arg("list")
            .stdin(Stdio::null())
            .output()
            .map_err(|e| CoreError::Adapter(format!("Failed to execute fnm list: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(CoreError::Adapter(format!("fnm list failed: {stderr}")));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut versions = Vec::new();
        for line in stdout.lines() {
            let trimmed = line.trim().trim_start_matches('*').trim();
            if trimmed.is_empty() {
                continue;
            }
            let token = trimmed.split_whitespace().next().unwrap_or("");
            if token.eq_ignore_ascii_case("system") || token.is_empty() {
                continue;
            }
            let normalized = normalize_version_display(token);
            if !normalized.is_empty() && !versions.contains(&normalized) {
                versions.push(normalized);
            }
        }
        // Sort descending by semver so newest matching version is picked first
        versions.sort_by(|a, b| compare_semver_desc(a, b));
        Ok(versions)
    }

    fn resolve_bin_dir(
        &self,
        version: &str,
        path_env: &str,
        cwd: &Path,
    ) -> CoreResult<Option<PathBuf>> {
        let Some(fnm_bin) = Self::find_fnm(path_env) else {
            return Ok(None);
        };

        let target = version.trim();
        if target.is_empty() {
            return Ok(None);
        }

        let mut cmd = Self::command_with_path(&fnm_bin, path_env);
        cmd.args([
            "exec",
            "--using",
            target,
            "--",
            "node",
            "-p",
            "process.execPath",
        ])
        .stdin(Stdio::null());

        if cwd.is_dir() {
            cmd.current_dir(cwd);
        }

        let output = cmd
            .output()
            .map_err(|e| CoreError::Adapter(format!("Failed to execute fnm exec: {e}")))?;

        if !output.status.success() {
            return Ok(None);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let exec_path_line = stdout
            .lines()
            .rev()
            .map(str::trim)
            .find(|l| !l.is_empty());

        let Some(node_exec) = exec_path_line else {
            return Ok(None);
        };

        let node_path = PathBuf::from(node_exec);
        Ok(node_path.parent().map(Path::to_path_buf))
    }

    fn install_version(
        &self,
        version: &str,
        path_env: &str,
        on_line: &mut dyn FnMut(String),
    ) -> CoreResult<String> {
        let Some(fnm_bin) = Self::find_fnm(path_env) else {
            return Err(CoreError::Adapter(
                "fnm is not available in PATH".to_string(),
            ));
        };

        let target = extract_install_target(version);
        if target.is_empty() {
            return Err(CoreError::Validation(
                "Target Node version cannot be empty".to_string(),
            ));
        }

        let mut child = Self::command_with_path(&fnm_bin, path_env)
            .args(["install", &target])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| CoreError::Adapter(format!("Failed to run fnm install {target}: {e}")))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let stderr_handle = stderr.map(|pipe| {
            std::thread::spawn(move || {
                let reader = BufReader::new(pipe);
                reader.lines().map_while(Result::ok).collect::<Vec<_>>()
            })
        });

        if let Some(pipe) = stdout {
            let reader = BufReader::new(pipe);
            for line in reader.lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    on_line(line);
                }
            }
        }

        let stderr_lines = stderr_handle
            .and_then(|h| h.join().ok())
            .unwrap_or_default();
        for line in &stderr_lines {
            if !line.trim().is_empty() {
                on_line(line.clone());
            }
        }

        let status = child
            .wait()
            .map_err(|e| CoreError::Adapter(format!("Failed waiting for fnm install: {e}")))?;

        if !status.success() {
            let tail = stderr_lines
                .last()
                .cloned()
                .unwrap_or_else(|| format!("exit code {:?}", status.code()));
            return Err(CoreError::Adapter(format!(
                "fnm install {target} failed: {tail}"
            )));
        }

        Ok(target)
    }
}

pub struct RuntimeResolver {
    managers: Vec<Arc<dyn VersionManager>>,
}

impl Default for RuntimeResolver {
    fn default() -> Self {
        Self::new()
    }
}

impl RuntimeResolver {
    pub fn new() -> Self {
        Self {
            managers: vec![Arc::new(FnmVersionManager::new())],
        }
    }

    pub fn with_managers(managers: Vec<Arc<dyn VersionManager>>) -> Self {
        Self { managers }
    }

    pub fn active_manager(&self, path_env: &str) -> Option<Arc<dyn VersionManager>> {
        self.managers
            .iter()
            .find(|m| m.is_available(path_env))
            .cloned()
    }

    /// Detect required Node version from service folder files:
    /// `.nvmrc` → `.node-version` → `package.json` `engines.node`.
    pub fn detect_folder_requirement(folder: &Path) -> (Option<String>, NodeVersionSource) {
        if let Some(v) = read_version_file(&folder.join(".nvmrc")) {
            return (Some(v), NodeVersionSource::Nvmrc);
        }
        if let Some(v) = read_version_file(&folder.join(".node-version")) {
            return (Some(v), NodeVersionSource::NodeVersionFile);
        }
        if let Some(v) = read_engines_node(&folder.join("package.json")) {
            return (Some(v), NodeVersionSource::EnginesNode);
        }
        (None, NodeVersionSource::None)
    }

    /// Resolve effective Node version requirement for a service.
    /// Manual override in Service Settings takes precedence over file detection
    /// (`.nvmrc` → `.node-version` → `engines.node`).
    pub fn resolve_requirement(service: &Service) -> (Option<String>, NodeVersionSource) {
        if let Some(override_ver) = service
            .node_version_override
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return (
                Some(override_ver.to_string()),
                NodeVersionSource::ManualOverride,
            );
        }
        Self::detect_folder_requirement(Path::new(&service.path))
    }

    pub fn inspect_service(&self, service: &Service, path_env: &str) -> ServiceNodeRuntime {
        let folder = Path::new(&service.path);
        let (detected_version, detected_source) = if folder.is_dir() {
            Self::detect_folder_requirement(folder)
        } else {
            (None, NodeVersionSource::None)
        };

        let manual_override = service
            .node_version_override
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string);

        let (required_version, source) = match &manual_override {
            Some(ov) => (Some(ov.clone()), NodeVersionSource::ManualOverride),
            None => (detected_version.clone(), detected_source),
        };

        let active_node_version = detect_active_node_version(path_env);
        let manager = self.active_manager(path_env);

        let (version_manager, installed_versions) = match &manager {
            Some(m) => {
                let installed = m.list_installed(path_env).unwrap_or_default();
                (Some(m.id().to_string()), installed)
            }
            None => (None, Vec::new()),
        };

        let Some(req) = required_version.as_deref() else {
            return ServiceNodeRuntime {
                service_id: service.id.clone(),
                required_version: None,
                source: NodeVersionSource::None,
                detected_version,
                detected_source,
                manual_override,
                version_manager,
                installed_versions,
                matched_installed_version: None,
                active_node_version,
                status: NodeRuntimeStatus::NoRequirement,
                warning: None,
                can_install: false,
                install_target: None,
            };
        };

        if let Some(m) = &manager {
            let matched = installed_versions
                .iter()
                .find(|cand| version_matches(req, cand))
                .cloned();

            if let Some(matched_ver) = matched {
                ServiceNodeRuntime {
                    service_id: service.id.clone(),
                    required_version: Some(req.to_string()),
                    source,
                    detected_version,
                    detected_source,
                    manual_override,
                    version_manager: Some(m.id().to_string()),
                    installed_versions,
                    matched_installed_version: Some(matched_ver),
                    active_node_version,
                    status: NodeRuntimeStatus::Matched,
                    warning: None,
                    can_install: false,
                    install_target: None,
                }
            } else {
                let install_target = extract_install_target(req);
                ServiceNodeRuntime {
                    service_id: service.id.clone(),
                    required_version: Some(req.to_string()),
                    source,
                    detected_version,
                    detected_source,
                    manual_override,
                    version_manager: Some(m.id().to_string()),
                    installed_versions,
                    matched_installed_version: None,
                    active_node_version,
                    status: NodeRuntimeStatus::MissingInManager,
                    warning: Some(format!(
                        "Node {req} belum terpasang di {}.",
                        m.display_name()
                    )),
                    can_install: true,
                    install_target: Some(install_target),
                }
            }
        } else {
            let matches_active = active_node_version
                .as_deref()
                .map(|active| version_matches(req, active))
                .unwrap_or(false);

            if matches_active {
                ServiceNodeRuntime {
                    service_id: service.id.clone(),
                    required_version: Some(req.to_string()),
                    source,
                    detected_version,
                    detected_source,
                    manual_override,
                    version_manager: None,
                    installed_versions: Vec::new(),
                    matched_installed_version: None,
                    active_node_version,
                    status: NodeRuntimeStatus::Matched,
                    warning: None,
                    can_install: false,
                    install_target: None,
                }
            } else {
                let active_label = active_node_version
                    .as_deref()
                    .unwrap_or("tidak terdeteksi");
                let warning = format!(
                    "Version manager (fnm) tidak ditemukan. Service membutuhkan Node {req}, sedangkan Node aktif adalah {active_label}."
                );
                ServiceNodeRuntime {
                    service_id: service.id.clone(),
                    required_version: Some(req.to_string()),
                    source,
                    detected_version,
                    detected_source,
                    manual_override,
                    version_manager: None,
                    installed_versions: Vec::new(),
                    matched_installed_version: None,
                    active_node_version,
                    status: NodeRuntimeStatus::MismatchNoManager,
                    warning: Some(warning),
                    can_install: false,
                    install_target: None,
                }
            }
        }
    }

    /// Resolves the Node binary directory to prepend to PATH when running a script.
    /// Returns `Ok(None)` when no requirement exists, no version manager is available,
    /// or the required version is not installed (non-blocking).
    pub fn resolve_runtime_bin_dir(
        &self,
        service: &Service,
        path_env: &str,
    ) -> CoreResult<Option<PathBuf>> {
        let (Some(req), _) = Self::resolve_requirement(service) else {
            return Ok(None);
        };
        let Some(manager) = self.active_manager(path_env) else {
            return Ok(None);
        };
        let installed = manager.list_installed(path_env).unwrap_or_default();
        let Some(matched) = installed.iter().find(|cand| version_matches(&req, cand)) else {
            return Ok(None);
        };
        manager.resolve_bin_dir(matched, path_env, Path::new(&service.path))
    }

    pub fn install_version(
        &self,
        version: &str,
        path_env: &str,
        on_progress: Option<Arc<dyn Fn(NodeInstallProgress) + Send + Sync>>,
    ) -> CoreResult<NodeInstallResult> {
        let Some(manager) = self.active_manager(path_env) else {
            return Err(CoreError::Adapter(
                "Tidak ada version manager (fnm) yang terdeteksi di PATH".to_string(),
            ));
        };

        let target = extract_install_target(version);
        if let Some(cb) = &on_progress {
            cb(NodeInstallProgress {
                version: target.clone(),
                manager: manager.id().to_string(),
                line: format!("Menjalankan {} install {}…", manager.display_name(), target),
                done: false,
                ok: None,
            });
        }

        let mut output_lines = Vec::new();
        let manager_id = manager.id().to_string();
        let res = manager.install_version(&target, path_env, &mut |line| {
            output_lines.push(line.clone());
            if let Some(cb) = &on_progress {
                cb(NodeInstallProgress {
                    version: target.clone(),
                    manager: manager_id.clone(),
                    line,
                    done: false,
                    ok: None,
                });
            }
        });

        match res {
            Ok(installed) => {
                if let Some(cb) = &on_progress {
                    cb(NodeInstallProgress {
                        version: installed.clone(),
                        manager: manager.id().to_string(),
                        line: format!("Node {installed} berhasil dipasang via {}.", manager.display_name()),
                        done: true,
                        ok: Some(true),
                    });
                }
                Ok(NodeInstallResult {
                    version: installed,
                    manager: manager.id().to_string(),
                    output_lines,
                })
            }
            Err(err) => {
                if let Some(cb) = &on_progress {
                    cb(NodeInstallProgress {
                        version: target.clone(),
                        manager: manager.id().to_string(),
                        line: err.to_string(),
                        done: true,
                        ok: Some(false),
                    });
                }
                Err(err)
            }
        }
    }
}

pub fn prepend_dir_to_path(dir: &Path, existing_path: &str) -> String {
    let mut paths = vec![dir.to_path_buf()];
    for p in std::env::split_paths(existing_path) {
        if p != dir {
            paths.push(p);
        }
    }
    std::env::join_paths(paths)
        .map(|os| os.to_string_lossy().into_owned())
        .unwrap_or_else(|_| {
            let sep = if cfg!(windows) { ";" } else { ":" };
            if existing_path.is_empty() {
                dir.display().to_string()
            } else {
                format!("{}{sep}{existing_path}", dir.display())
            }
        })
}

fn read_version_file(path: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        return Some(trimmed.to_string());
    }
    None
}

fn read_engines_node(pkg_json_path: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(pkg_json_path).ok()?;
    let json: Value = serde_json::from_str(&raw).ok()?;
    let engines = json.get("engines")?.get("node")?.as_str()?;
    let trimmed = engines.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn detect_active_node_version(path_env: &str) -> Option<String> {
    let node_bin = resolve_program_in_path("node", path_env);
    if !node_bin.is_file() {
        return None;
    }
    let mut cmd = Command::new(&node_bin);
    if !path_env.is_empty() {
        cmd.env("PATH", path_env);
    }
    let output = cmd.arg("-v").stdin(Stdio::null()).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(normalize_version_display(&text))
    }
}

fn normalize_version_display(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        return String::new();
    }
    if t.starts_with('v') || t.starts_with('V') {
        format!("v{}", &t[1..])
    } else if t.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        format!("v{t}")
    } else {
        t.to_string()
    }
}

/// Extracts an installable version string for `fnm install <target>` from a spec
/// such as `v20.11.1`, `20`, `>=20.10.0`, `^18.19.0`, or `lts/*`.
pub fn extract_install_target(spec: &str) -> String {
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.eq_ignore_ascii_case("lts/*") || trimmed.to_ascii_lowercase().starts_with("lts/") {
        return "--lts".to_string();
    }
    // Take first OR branch if range contains `||`
    let first_branch = trimmed.split("||").next().unwrap_or(trimmed).trim();
    // Take first token and strip range operators
    let token = first_branch
        .split_whitespace()
        .next()
        .unwrap_or(first_branch)
        .trim_start_matches(|c: char| matches!(c, '>' | '<' | '=' | '^' | '~' | 'v' | 'V'));

    // Strip trailing `.x` or `.*`
    let cleaned = token
        .trim_end_matches(".*")
        .trim_end_matches(".x")
        .trim_end_matches(".X");

    if cleaned.is_empty() {
        trimmed.to_string()
    } else {
        cleaned.to_string()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Semver {
    major: u64,
    minor: u64,
    patch: u64,
}

fn parse_partial_semver(raw: &str) -> Option<(u64, Option<u64>, Option<u64>)> {
    let cleaned = raw
        .trim()
        .trim_start_matches(|c: char| c == 'v' || c == 'V')
        .split('-')
        .next()
        .unwrap_or("")
        .split('+')
        .next()
        .unwrap_or("");
    let parts: Vec<&str> = cleaned.split('.').collect();
    if parts.is_empty() {
        return None;
    }
    let major = parts[0].parse::<u64>().ok()?;
    let minor = parts
        .get(1)
        .and_then(|p| if *p == "x" || *p == "X" || *p == "*" { None } else { p.parse::<u64>().ok() });
    let patch = parts
        .get(2)
        .and_then(|p| if *p == "x" || *p == "X" || *p == "*" { None } else { p.parse::<u64>().ok() });
    Some((major, minor, patch))
}

fn parse_full_semver(raw: &str) -> Option<Semver> {
    let (major, minor, patch) = parse_partial_semver(raw)?;
    Some(Semver {
        major,
        minor: minor.unwrap_or(0),
        patch: patch.unwrap_or(0),
    })
}

fn compare_semver_desc(a: &str, b: &str) -> std::cmp::Ordering {
    match (parse_full_semver(a), parse_full_semver(b)) {
        (Some(sa), Some(sb)) => sb.cmp(&sa),
        _ => b.cmp(a),
    }
}

pub fn version_matches(required_spec: &str, candidate: &str) -> bool {
    let spec = required_spec.trim();
    if spec.is_empty() {
        return true;
    }
    if spec.eq_ignore_ascii_case(candidate.trim()) {
        return true;
    }
    let Some(cand) = parse_full_semver(candidate) else {
        return false;
    };

    // Support `||` OR branches
    for branch in spec.split("||") {
        let branch = branch.trim();
        if branch.is_empty() {
            continue;
        }
        // Each whitespace-separated comparator in a branch must match
        let all_match = branch
            .split_whitespace()
            .all(|comp| comparator_matches(comp, cand));
        if all_match {
            return true;
        }
    }

    false
}

fn comparator_matches(comp: &str, cand: Semver) -> bool {
    let c = comp.trim();
    if c.is_empty() || c == "*" || c.eq_ignore_ascii_case("x") || c.eq_ignore_ascii_case("lts/*") {
        return true;
    }

    if let Some(rest) = c.strip_prefix(">=") {
        return parse_full_semver(rest).is_some_and(|v| cand >= v);
    }
    if let Some(rest) = c.strip_prefix("<=") {
        return parse_full_semver(rest).is_some_and(|v| cand <= v);
    }
    if let Some(rest) = c.strip_prefix('>') {
        return parse_full_semver(rest).is_some_and(|v| cand > v);
    }
    if let Some(rest) = c.strip_prefix('<') {
        return parse_full_semver(rest).is_some_and(|v| cand < v);
    }
    if let Some(rest) = c.strip_prefix('^') {
        let Some((maj, min, pat)) = parse_partial_semver(rest) else {
            return false;
        };
        let min_v = Semver {
            major: maj,
            minor: min.unwrap_or(0),
            patch: pat.unwrap_or(0),
        };
        let upper = if maj > 0 {
            Semver {
                major: maj + 1,
                minor: 0,
                patch: 0,
            }
        } else {
            Semver {
                major: 0,
                minor: min.unwrap_or(0) + 1,
                patch: 0,
            }
        };
        return cand >= min_v && cand < upper;
    }
    if let Some(rest) = c.strip_prefix('~') {
        let Some((maj, min, pat)) = parse_partial_semver(rest) else {
            return false;
        };
        let min_v = Semver {
            major: maj,
            minor: min.unwrap_or(0),
            patch: pat.unwrap_or(0),
        };
        let upper = match min {
            Some(m) => Semver {
                major: maj,
                minor: m + 1,
                patch: 0,
            },
            None => Semver {
                major: maj + 1,
                minor: 0,
                patch: 0,
            },
        };
        return cand >= min_v && cand < upper;
    }

    let exact_or_prefix = c.strip_prefix('=').unwrap_or(c);
    let Some((maj, min, pat)) = parse_partial_semver(exact_or_prefix) else {
        return false;
    };
    if cand.major != maj {
        return false;
    }
    if let Some(m) = min {
        if cand.minor != m {
            return false;
        }
    }
    if let Some(p) = pat {
        if cand.patch != p {
            return false;
        }
    }
    true
}
