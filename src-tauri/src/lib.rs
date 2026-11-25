use devdock_core::models::{
    AppBootstrapInfo, AttachedPreset, DbTestResult, DesktopToolSettings, EnvPreset, EnvWriteResult,
    ExportSummary, FolderRelocationCheck, GitStatusInfo, GlobalStorageSummary, HostsSyncPreview,
    HostsSyncResult, ImportPreview, ImportResult, LogExportScope, LogLine, MetricsSnapshot,
    NodeInstallResult, PackageManager, PortCheckResult, PortInjectionMethod, PortInspectorSnapshot,
    PresetEntryInput, ProcessEvent, ProcessInfo, Project, ProjectEnvSummary,
    ProjectOrchestrationResult, ProjectStatusSummary, ProjectStorageSummary, ProxyStatus,
    QuickActionTarget, ScanResult, Service, ServiceEnvInspection, ServiceNodeRuntime,
    ServiceStorageReport, StorageCleanResult,
};
use devdock_core::monitor::DEFAULT_MONITOR_INTERVAL;
use devdock_core::secret_store::OsKeychainSecretStore;
use devdock_core::traits::Notifier;
use devdock_core::DevDockCore;

struct OsDesktopNotifier;

impl Notifier for OsDesktopNotifier {
    fn notify(&self, title: &str, body: &str) -> devdock_core::error::CoreResult<()> {
        #[cfg(target_os = "macos")]
        {
            let escaped_title = title.replace('\\', "\\\\").replace('"', "\\\"");
            let escaped_body = body.replace('\\', "\\\\").replace('"', "\\\"");
            let script = format!(
                "display notification \"{escaped_body}\" with title \"DevDock\" subtitle \"{escaped_title}\""
            );
            let _ = std::process::Command::new("osascript")
                .args(["-e", &script])
                .spawn();
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (title, body);
        }
        Ok(())
    }
}
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Listener, Manager, RunEvent, State, WindowEvent};

pub struct WatcherState {
    watcher: RecommendedWatcher,
    watched_dirs: HashSet<PathBuf>,
}

impl WatcherState {
    pub fn sync_paths(&mut self, paths: Vec<PathBuf>) {
        let next: HashSet<PathBuf> = paths.into_iter().filter(|p| p.is_dir()).collect();
        for removed in self.watched_dirs.difference(&next) {
            let _ = self.watcher.unwatch(removed);
        }
        for added in next.difference(&self.watched_dirs) {
            let _ = self.watcher.watch(added, RecursiveMode::NonRecursive);
        }
        self.watched_dirs = next;
    }
}

pub struct AppState {
    pub core: Arc<DevDockCore>,
    pub watcher: Mutex<Option<WatcherState>>,
    pub allow_exit: Arc<AtomicBool>,
}

impl AppState {
    pub fn sync_watchers(&self) {
        if let Ok(projects) = self.core.list_projects() {
            let dirs: Vec<PathBuf> = projects
                .into_iter()
                .flat_map(|p| p.services)
                .map(|s| PathBuf::from(s.path))
                .collect();
            if let Ok(mut guard) = self.watcher.lock() {
                if let Some(ws) = guard.as_mut() {
                    ws.sync_paths(dirs);
                }
            }
        }
    }

    pub fn sync_proxy_and_emit(&self, app: &AppHandle) {
        if let Ok(status) = self.core.sync_proxy_routes() {
            let _ = app.emit("proxy:status", status);
        }
        refresh_tray_menu(app, &self.core);
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray_menu(app: &AppHandle, core: &DevDockCore) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let processes = core.list_processes();
    let active_count = processes.iter().filter(|p| p.status.is_active()).count();

    let status_label = if active_count > 0 {
        format!("DevDock · {active_count} proses berjalan")
    } else {
        "DevDock · Idle".to_string()
    };
    let header_item = MenuItem::with_id(app, "tray:status", status_label, false, None::<&str>)?;
    let show_item = MenuItem::with_id(app, "tray:show", "Tampilkan DevDock", true, None::<&str>)?;
    menu.append(&header_item)?;
    menu.append(&show_item)?;

    if let Ok(projects) = core.list_projects() {
        if !projects.is_empty() {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
            for proj in projects.iter().take(12) {
                let running_in_proj = proj
                    .services
                    .iter()
                    .filter(|s| {
                        processes
                            .iter()
                            .any(|p| p.service_id == s.id && p.status.is_active())
                    })
                    .count();

                if proj.services.len() == 1 {
                    let svc = &proj.services[0];
                    let is_up = running_in_proj > 0;
                    let sub_title = if is_up {
                        format!("● {} (running)", proj.name)
                    } else {
                        proj.name.clone()
                    };
                    let sub = Submenu::new(app, sub_title, true)?;
                    let toggle_label = if is_up { "Stop" } else { "Start" };
                    sub.append(&MenuItem::with_id(
                        app,
                        format!("tray:svc:toggle:{}", svc.id),
                        toggle_label,
                        !svc.is_missing,
                        None::<&str>,
                    )?)?;
                    sub.append(&MenuItem::with_id(
                        app,
                        format!("tray:svc:browser:{}", svc.id),
                        "Open in Browser",
                        true,
                        None::<&str>,
                    )?)?;
                    menu.append(&sub)?;
                } else {
                    let sub_title = if running_in_proj > 0 {
                        format!(
                            "● {} ({}/{})",
                            proj.name,
                            running_in_proj,
                            proj.services.length_or_len()
                        )
                    } else {
                        format!("{} (0/{})", proj.name, proj.services.len())
                    };
                    let sub = Submenu::new(app, sub_title, true)?;
                    if running_in_proj > 0 {
                        sub.append(&MenuItem::with_id(
                            app,
                            format!("tray:proj:stop:{}", proj.id),
                            "Stop All",
                            true,
                            None::<&str>,
                        )?)?;
                    } else {
                        sub.append(&MenuItem::with_id(
                            app,
                            format!("tray:proj:start:{}", proj.id),
                            "Start All",
                            true,
                            None::<&str>,
                        )?)?;
                    }
                    sub.append(&PredefinedMenuItem::separator(app)?)?;
                    for svc in &proj.services {
                        let is_up = processes
                            .iter()
                            .any(|p| p.service_id == svc.id && p.status.is_active());
                        let svc_sub = Submenu::new(
                            app,
                            if is_up {
                                format!("● {}", svc.name)
                            } else {
                                svc.name.clone()
                            },
                            true,
                        )?;
                        svc_sub.append(&MenuItem::with_id(
                            app,
                            format!("tray:svc:toggle:{}", svc.id),
                            if is_up { "Stop" } else { "Start" },
                            !svc.is_missing,
                            None::<&str>,
                        )?)?;
                        svc_sub.append(&MenuItem::with_id(
                            app,
                            format!("tray:svc:browser:{}", svc.id),
                            "Open in Browser",
                            true,
                            None::<&str>,
                        )?)?;
                        sub.append(&svc_sub)?;
                    }
                    menu.append(&sub)?;
                }
            }
        }
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "tray:quit",
        "Keluar DevDock",
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

trait VecLenExt {
    fn length_or_len(&self) -> usize;
}
impl<T> VecLenExt for Vec<T> {
    fn length_or_len(&self) -> usize {
        self.len()
    }
}

fn refresh_tray_menu(app: &AppHandle, core: &DevDockCore) {
    if let Some(tray) = app.tray_by_id("devdock-tray") {
        if let Ok(menu) = build_tray_menu(app, core) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

fn handle_tray_menu_event(app: &AppHandle, id: &str) {
    if id == "tray:show" {
        show_main_window(app);
        return;
    }

    let state = app.state::<AppState>();
    let core = Arc::clone(&state.core);

    if id == "tray:quit" {
        let active = core.active_process_count();
        if active > 0 {
            show_main_window(app);
            let _ = app.emit(
                "app:quit-requested",
                serde_json::json!({ "activeCount": active }),
            );
        } else {
            state.allow_exit.store(true, Ordering::SeqCst);
            app.exit(0);
        }
        return;
    }

    if let Some(svc_id) = id.strip_prefix("tray:svc:toggle:") {
        let svc_id = svc_id.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let active: Vec<ProcessInfo> = core
                .list_processes()
                .into_iter()
                .filter(|p| p.service_id == svc_id && p.status.is_active())
                .collect();
            if !active.is_empty() {
                for p in active {
                    let _ = core.stop_process(&p.id);
                }
            } else if let Ok(svc) = core.get_service(&svc_id) {
                let script = svc
                    .default_script
                    .clone()
                    .filter(|s| svc.scripts.contains_key(s))
                    .or_else(|| {
                        ["dev", "start:dev", "serve", "start"]
                            .iter()
                            .find(|k| svc.scripts.contains_key(**k))
                            .map(|s| (*s).to_string())
                    })
                    .or_else(|| svc.scripts.keys().next().cloned());
                if let Some(script_name) = script {
                    let _ = core.run_service_script(&svc_id, &script_name);
                }
            }
        });
        return;
    }

    if let Some(svc_id) = id.strip_prefix("tray:svc:browser:") {
        let _ = core.open_service_quick_action(svc_id, QuickActionTarget::Browser);
        return;
    }

    if let Some(proj_id) = id.strip_prefix("tray:proj:start:") {
        let proj_id = proj_id.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = core.start_project_all(&proj_id);
        });
        return;
    }

    if let Some(proj_id) = id.strip_prefix("tray:proj:stop:") {
        let proj_id = proj_id.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = core.stop_project_all(&proj_id);
        });
    }
}

#[tauri::command]
fn get_bootstrap_info(state: State<'_, AppState>) -> Result<AppBootstrapInfo, String> {
    state.core.bootstrap_info().map_err(|e| e.to_string())
}

#[tauri::command]
fn refresh_shell_path(state: State<'_, AppState>) -> Result<String, String> {
    state.core.refresh_shell_path().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_setting(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    state.core.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    state
        .core
        .set_setting(&key, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    state.core.list_projects().map_err(|e| e.to_string())
}

#[tauri::command]
fn register_folder_as_project(
    app: AppHandle,
    state: State<'_, AppState>,
    folder: String,
    project_name: Option<String>,
) -> Result<Project, String> {
    let project = state
        .core
        .register_folder_as_project(PathBuf::from(folder).as_path(), project_name.as_deref())
        .map_err(|e| e.to_string())?;
    state.sync_watchers();
    state.sync_proxy_and_emit(&app);
    Ok(project)
}

#[tauri::command]
fn attach_folder_to_project(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    folder: String,
    service_name: Option<String>,
) -> Result<Service, String> {
    let service = state
        .core
        .attach_folder_to_project(
            &project_id,
            PathBuf::from(folder).as_path(),
            service_name.as_deref(),
        )
        .map_err(|e| e.to_string())?;
    state.sync_watchers();
    state.sync_proxy_and_emit(&app);
    Ok(service)
}

#[tauri::command]
fn refresh_service(state: State<'_, AppState>, service_id: String) -> Result<Service, String> {
    state
        .core
        .refresh_service(&service_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_project(
    state: State<'_, AppState>,
    project_id: String,
    new_name: String,
) -> Result<Project, String> {
    state
        .core
        .rename_project(&project_id, &new_name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_service(
    state: State<'_, AppState>,
    service_id: String,
    new_name: String,
) -> Result<Service, String> {
    state
        .core
        .rename_service(&service_id, &new_name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_service_pm_override(
    state: State<'_, AppState>,
    service_id: String,
    pm_override: Option<PackageManager>,
) -> Result<Service, String> {
    state
        .core
        .set_service_pm_override(&service_id, pm_override)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_service_node_version_override(
    state: State<'_, AppState>,
    service_id: String,
    version: Option<String>,
) -> Result<Service, String> {
    state
        .core
        .set_service_node_version_override(&service_id, version.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_script_auto_restart(
    state: State<'_, AppState>,
    service_id: String,
    script_name: String,
    enabled: bool,
) -> Result<Service, String> {
    state
        .core
        .set_script_auto_restart(&service_id, &script_name, enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_service_default_script(
    state: State<'_, AppState>,
    service_id: String,
    default_script: Option<String>,
) -> Result<Service, String> {
    state
        .core
        .set_service_default_script(&service_id, default_script.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn reorder_project_services(
    state: State<'_, AppState>,
    project_id: String,
    service_ids: Vec<String>,
) -> Result<Project, String> {
    state
        .core
        .reorder_project_services(&project_id, &service_ids)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_project_status(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<ProjectStatusSummary, String> {
    state
        .core
        .compute_project_status(&project_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_project_all(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<ProjectOrchestrationResult, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.start_project_all(&project_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn stop_project_all(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<ProjectOrchestrationResult, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.stop_project_all(&project_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn restart_project_all(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<ProjectOrchestrationResult, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.restart_project_all(&project_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn clean_project_build_caches(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<StorageCleanResult>, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.clean_project_build_caches(&project_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn set_service_port(
    app: AppHandle,
    state: State<'_, AppState>,
    service_id: String,
    port: Option<u16>,
) -> Result<Service, String> {
    let svc = state
        .core
        .set_service_port(&service_id, port)
        .map_err(|e| e.to_string())?;
    state.sync_proxy_and_emit(&app);
    Ok(svc)
}

#[tauri::command]
fn set_service_port_injection(
    state: State<'_, AppState>,
    service_id: String,
    method: Option<PortInjectionMethod>,
) -> Result<Service, String> {
    state
        .core
        .set_service_port_injection(&service_id, method)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn ensure_service_port(state: State<'_, AppState>, service_id: String) -> Result<u16, String> {
    state
        .core
        .ensure_service_port(&service_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_service_port(
    state: State<'_, AppState>,
    service_id: String,
) -> Result<PortCheckResult, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.check_service_port(&service_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn assign_next_free_port(
    app: AppHandle,
    state: State<'_, AppState>,
    service_id: String,
) -> Result<Service, String> {
    let core = Arc::clone(&state.core);
    let svc = tauri::async_runtime::spawn_blocking(move || {
        core.assign_next_free_port(&service_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    state.sync_proxy_and_emit(&app);
    Ok(svc)
}

#[tauri::command]
async fn inspect_listening_ports(
    state: State<'_, AppState>,
) -> Result<PortInspectorSnapshot, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.inspect_listening_ports().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn kill_port_owner(state: State<'_, AppState>, pid: u32) -> Result<(), String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.kill_port_owner(pid).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn inspect_service_node_runtime(
    state: State<'_, AppState>,
    service_id: String,
) -> Result<ServiceNodeRuntime, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.inspect_service_node_runtime(&service_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn install_node_version(
    app: AppHandle,
    state: State<'_, AppState>,
    version: String,
) -> Result<NodeInstallResult, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        let handle = app.clone();
        core.install_node_version(
            &version,
            Some(Arc::new(move |progress| {
                let _ = handle.emit("node:install-progress", progress);
            })),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn relocate_service(
    state: State<'_, AppState>,
    service_id: String,
    new_folder: String,
) -> Result<Service, String> {
    let service = state
        .core
        .relocate_service(&service_id, PathBuf::from(new_folder).as_path())
        .map_err(|e| e.to_string())?;
    state.sync_watchers();
    Ok(service)
}

#[tauri::command]
fn remove_service(
    app: AppHandle,
    state: State<'_, AppState>,
    service_id: String,
) -> Result<(), String> {
    state
        .core
        .remove_service(&service_id)
        .map_err(|e| e.to_string())?;
    state.sync_watchers();
    state.sync_proxy_and_emit(&app);
    Ok(())
}

#[tauri::command]
fn remove_project(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> Result<(), String> {
    state
        .core
        .remove_project(&project_id)
        .map_err(|e| e.to_string())?;
    state.sync_watchers();
    state.sync_proxy_and_emit(&app);
    Ok(())
}

#[tauri::command]
async fn scan_folder(
    state: State<'_, AppState>,
    root: String,
    max_depth: Option<usize>,
) -> Result<ScanResult, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.scan_folder(PathBuf::from(root).as_path(), max_depth)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn register_grouped_project(
    app: AppHandle,
    state: State<'_, AppState>,
    project_name: String,
    folders: Vec<String>,
    root_path: Option<String>,
) -> Result<Project, String> {
    let paths: Vec<PathBuf> = folders.into_iter().map(PathBuf::from).collect();
    let root_pb = root_path.map(PathBuf::from);
    let project = state
        .core
        .register_grouped_project(&project_name, &paths, root_pb.as_deref())
        .map_err(|e| e.to_string())?;
    state.sync_watchers();
    state.sync_proxy_and_emit(&app);
    Ok(project)
}

#[tauri::command]
fn inspect_service_env(
    state: State<'_, AppState>,
    service_id: String,
    mode: Option<String>,
) -> Result<ServiceEnvInspection, String> {
    state
        .core
        .inspect_service_env(&service_id, mode.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn write_service_env(
    state: State<'_, AppState>,
    service_id: String,
    target_file: String,
    entries: BTreeMap<String, String>,
) -> Result<EnvWriteResult, String> {
    state
        .core
        .write_service_env(&service_id, &target_file, &entries)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_service_env_key(
    state: State<'_, AppState>,
    service_id: String,
    target_file: String,
    key: String,
    value: String,
) -> Result<EnvWriteResult, String> {
    state
        .core
        .update_service_env_key(&service_id, &target_file, &key, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_presets(state: State<'_, AppState>) -> Result<Vec<EnvPreset>, String> {
    state.core.list_presets().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_preset(state: State<'_, AppState>, preset_id: String) -> Result<EnvPreset, String> {
    state.core.get_preset(&preset_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_preset(
    state: State<'_, AppState>,
    name: String,
    entries: Vec<PresetEntryInput>,
) -> Result<EnvPreset, String> {
    state
        .core
        .create_preset(&name, &entries)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_preset(
    state: State<'_, AppState>,
    preset_id: String,
    name: String,
    entries: Vec<PresetEntryInput>,
) -> Result<EnvPreset, String> {
    state
        .core
        .update_preset(&preset_id, &name, &entries)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_preset(state: State<'_, AppState>, preset_id: String) -> Result<(), String> {
    state
        .core
        .delete_preset(&preset_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn attach_preset_to_project(
    state: State<'_, AppState>,
    project_id: String,
    preset_id: String,
) -> Result<Vec<AttachedPreset>, String> {
    state
        .core
        .attach_preset_to_project(&project_id, &preset_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn detach_preset_from_project(
    state: State<'_, AppState>,
    project_id: String,
    preset_id: String,
) -> Result<Vec<AttachedPreset>, String> {
    state
        .core
        .detach_preset_from_project(&project_id, &preset_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn reorder_project_presets(
    state: State<'_, AppState>,
    project_id: String,
    preset_ids: Vec<String>,
) -> Result<Vec<AttachedPreset>, String> {
    state
        .core
        .reorder_project_presets(&project_id, &preset_ids)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn attach_preset_to_service(
    state: State<'_, AppState>,
    service_id: String,
    preset_id: String,
) -> Result<Vec<AttachedPreset>, String> {
    state
        .core
        .attach_preset_to_service(&service_id, &preset_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn detach_preset_from_service(
    state: State<'_, AppState>,
    service_id: String,
    preset_id: String,
) -> Result<Vec<AttachedPreset>, String> {
    state
        .core
        .detach_preset_from_service(&service_id, &preset_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn reorder_service_presets(
    state: State<'_, AppState>,
    service_id: String,
    preset_ids: Vec<String>,
) -> Result<Vec<AttachedPreset>, String> {
    state
        .core
        .reorder_service_presets(&service_id, &preset_ids)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn inspect_project_shared_env(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<ProjectEnvSummary, String> {
    state
        .core
        .inspect_project_shared_env(&project_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn test_service_db_connection(
    state: State<'_, AppState>,
    service_id: String,
    key: String,
    mode: Option<String>,
    value_override: Option<String>,
) -> Result<DbTestResult, String> {
    state
        .core
        .test_service_db_connection(
            &service_id,
            &key,
            mode.as_deref(),
            value_override.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn test_project_db_connection(
    state: State<'_, AppState>,
    project_id: String,
    key: String,
) -> Result<DbTestResult, String> {
    state
        .core
        .test_project_db_connection(&project_id, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn analyze_service_storage(
    state: State<'_, AppState>,
    service_id: String,
    force_refresh: bool,
) -> Result<ServiceStorageReport, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.analyze_service_storage(&service_id, force_refresh)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn analyze_project_storage(
    state: State<'_, AppState>,
    project_id: String,
    force_refresh: bool,
) -> Result<ProjectStorageSummary, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.analyze_project_storage(&project_id, force_refresh)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_cached_global_storage(state: State<'_, AppState>) -> Result<GlobalStorageSummary, String> {
    state
        .core
        .get_cached_global_storage()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn analyze_all_storage(
    state: State<'_, AppState>,
    force_refresh: bool,
) -> Result<GlobalStorageSummary, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.analyze_all_storage(force_refresh)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn clean_service_storage(
    state: State<'_, AppState>,
    service_id: String,
    folder_name: String,
) -> Result<StorageCleanResult, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.clean_service_storage(&service_id, &folder_name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn run_service_script(
    state: State<'_, AppState>,
    service_id: String,
    script: String,
) -> Result<ProcessInfo, String> {
    state
        .core
        .run_service_script(&service_id, &script)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop_process(state: State<'_, AppState>, process_id: String) -> Result<ProcessInfo, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.stop_process(&process_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn restart_process(
    state: State<'_, AppState>,
    process_id: String,
) -> Result<ProcessInfo, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.restart_process(&process_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_processes(state: State<'_, AppState>) -> Result<Vec<ProcessInfo>, String> {
    Ok(state.core.list_processes())
}

#[tauri::command]
async fn get_metrics_snapshot(state: State<'_, AppState>) -> Result<MetricsSnapshot, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || core.get_metrics_snapshot())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_process_logs(
    state: State<'_, AppState>,
    process_id: String,
    filter: Option<String>,
    stderr_only: bool,
) -> Result<Vec<LogLine>, String> {
    state
        .core
        .get_process_logs(&process_id, filter.as_deref(), stderr_only)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_project_logs(
    state: State<'_, AppState>,
    project_id: String,
    filter: Option<String>,
    stderr_only: bool,
) -> Result<Vec<LogLine>, String> {
    Ok(state
        .core
        .get_project_logs(&project_id, filter.as_deref(), stderr_only))
}

#[tauri::command]
fn get_all_logs(
    state: State<'_, AppState>,
    filter: Option<String>,
    stderr_only: bool,
) -> Result<Vec<LogLine>, String> {
    Ok(state.core.get_all_logs(filter.as_deref(), stderr_only))
}

#[tauri::command]
fn clear_process_logs(state: State<'_, AppState>, process_id: String) -> Result<(), String> {
    state
        .core
        .clear_process_logs(&process_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_project_logs(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    state.core.clear_project_logs(&project_id);
    Ok(())
}

#[tauri::command]
fn export_logs_to_file(
    state: State<'_, AppState>,
    scope_kind: String,
    scope_id: Option<String>,
    path: String,
    filter: Option<String>,
    stderr_only: bool,
    strip_ansi: bool,
) -> Result<usize, String> {
    let scope = match scope_kind.as_str() {
        "process" => LogExportScope::Process(
            scope_id.ok_or_else(|| "Missing process id for log export".to_string())?,
        ),
        "project" => LogExportScope::Project(
            scope_id.ok_or_else(|| "Missing project id for log export".to_string())?,
        ),
        "all" => LogExportScope::All,
        other => return Err(format!("Unsupported log export scope: {other}")),
    };

    state
        .core
        .export_logs_to_file(
            &scope,
            PathBuf::from(path).as_path(),
            filter.as_deref(),
            stderr_only,
            strip_ansi,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_proxy_status(state: State<'_, AppState>) -> Result<ProxyStatus, String> {
    state.core.get_proxy_status().map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_proxy_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<ProxyStatus, String> {
    let core = Arc::clone(&state.core);
    let status = tauri::async_runtime::spawn_blocking(move || {
        core.set_proxy_enabled(enabled).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit("proxy:status", &status);
    Ok(status)
}

#[tauri::command]
fn preview_hosts_sync(state: State<'_, AppState>) -> Result<HostsSyncPreview, String> {
    state.core.preview_hosts_sync().map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_etc_hosts(state: State<'_, AppState>) -> Result<HostsSyncResult, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || core.sync_etc_hosts().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_external_url(state: State<'_, AppState>, url: String) -> Result<(), String> {
    state.core.open_external_url(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_service_git_info(
    state: State<'_, AppState>,
    service_id: String,
) -> Result<GitStatusInfo, String> {
    state
        .core
        .get_service_git_info(&service_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_all_services_git_info(
    state: State<'_, AppState>,
) -> Result<HashMap<String, GitStatusInfo>, String> {
    state
        .core
        .get_all_services_git_info()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_desktop_tool_settings(state: State<'_, AppState>) -> Result<DesktopToolSettings, String> {
    state
        .core
        .get_desktop_tool_settings()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_default_editor(
    state: State<'_, AppState>,
    editor_id: Option<String>,
) -> Result<DesktopToolSettings, String> {
    state
        .core
        .set_default_editor(editor_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_default_terminal(
    state: State<'_, AppState>,
    terminal_id: Option<String>,
) -> Result<DesktopToolSettings, String> {
    state
        .core
        .set_default_terminal(terminal_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_service_quick_action(
    state: State<'_, AppState>,
    service_id: String,
    target: QuickActionTarget,
) -> Result<(), String> {
    state
        .core
        .open_service_quick_action(&service_id, target)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn confirm_app_quit(
    app: AppHandle,
    state: State<'_, AppState>,
    stop_processes: bool,
) -> Result<(), String> {
    let core = Arc::clone(&state.core);
    if stop_processes {
        tauri::async_runtime::spawn_blocking(move || {
            core.stop_all_processes();
        })
        .await
        .map_err(|e| e.to_string())?;
    } else {
        core.detach_processes_on_exit();
    }
    state.allow_exit.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn export_config_to_file(
    state: State<'_, AppState>,
    output_path: String,
    include_secrets: bool,
    passphrase: Option<String>,
) -> Result<ExportSummary, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        core.export_config_to_file(
            PathBuf::from(output_path).as_path(),
            include_secrets,
            passphrase.as_deref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn preview_import_file(
    state: State<'_, AppState>,
    input_path: String,
    passphrase: Option<String>,
    old_parent: Option<String>,
    new_parent: Option<String>,
    path_overrides: HashMap<String, String>,
) -> Result<ImportPreview, String> {
    let core = Arc::clone(&state.core);
    tauri::async_runtime::spawn_blocking(move || {
        let raw_json = std::fs::read_to_string(&input_path).map_err(|e| e.to_string())?;
        let remap = match (old_parent.as_deref(), new_parent.as_deref()) {
            (Some(o), Some(n)) if !o.trim().is_empty() && !n.trim().is_empty() => Some((o, n)),
            _ => None,
        };
        core.preview_import_bundle(&raw_json, passphrase.as_deref(), remap, &path_overrides)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn apply_import_file(
    app: AppHandle,
    state: State<'_, AppState>,
    input_path: String,
    passphrase: Option<String>,
    old_parent: Option<String>,
    new_parent: Option<String>,
    path_overrides: HashMap<String, String>,
) -> Result<ImportResult, String> {
    let core = Arc::clone(&state.core);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let raw_json = std::fs::read_to_string(&input_path).map_err(|e| e.to_string())?;
        let remap = match (old_parent.as_deref(), new_parent.as_deref()) {
            (Some(o), Some(n)) if !o.trim().is_empty() && !n.trim().is_empty() => Some((o, n)),
            _ => None,
        };
        core.apply_import_bundle(&raw_json, passphrase.as_deref(), remap, &path_overrides)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    state.sync_watchers();
    state.sync_proxy_and_emit(&app);
    Ok(result)
}

#[tauri::command]
fn validate_relocation_folder(
    state: State<'_, AppState>,
    folder: String,
    expected_package_name: Option<String>,
) -> FolderRelocationCheck {
    state.core.validate_relocation_folder(
        PathBuf::from(folder).as_path(),
        expected_package_name.as_deref(),
    )
}

fn create_package_json_watcher(app_handle: AppHandle) -> Option<WatcherState> {
    let watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let touches_pkg_json = event
                .paths
                .iter()
                .any(|p| p.file_name().and_then(|n| n.to_str()) == Some("package.json"));
            if touches_pkg_json {
                let _ = app_handle.emit("projects:changed", ());
            }
        }
    })
    .ok()?;

    Some(WatcherState {
        watcher,
        watched_dirs: HashSet::new(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = match std::env::var("DEVDOCK_DATA_DIR") {
                Ok(custom) if !custom.trim().is_empty() => PathBuf::from(custom),
                _ => app
                    .path()
                    .app_data_dir()
                    .expect("failed to resolve OS app data directory"),
            };
            let db_path = data_dir.join("devdock.sqlite");

            let core = Arc::new(
                DevDockCore::open_desktop(
                    &db_path,
                    Arc::new(OsKeychainSecretStore::new()),
                    Arc::new(OsDesktopNotifier),
                )
                .expect("failed to initialize DevDock core"),
            );

            let event_handle = app.handle().clone();
            let event_core = Arc::clone(&core);
            core.subscribe_process_events(Arc::new(move |event| match event {
                ProcessEvent::StatusChanged(info) => {
                    let _ = event_handle.emit("process:status", info);
                    if let Ok(proxy_status) = event_core.sync_proxy_routes() {
                        let _ = event_handle.emit("proxy:status", proxy_status);
                    }
                    refresh_tray_menu(&event_handle, &event_core);
                }
                ProcessEvent::LogLine(line) => {
                    let _ = event_handle.emit("process:log", line);
                }
                ProcessEvent::LogsCleared { process_id } => {
                    let _ = event_handle.emit(
                        "process:logs-cleared",
                        serde_json::json!({ "processId": process_id }),
                    );
                }
                ProcessEvent::CrashNotification(crash) => {
                    let _ = event_handle.emit("process:crashed", crash);
                }
                ProcessEvent::OrchestrationStep(step) => {
                    let _ = event_handle.emit("project:orchestration", step);
                }
            }));

            // Start *.localhost reverse proxy unless disabled in Settings
            let proxy_enabled = core
                .get_setting("proxy_enabled")
                .ok()
                .flatten()
                .map(|v| v != "false")
                .unwrap_or(true);
            if proxy_enabled {
                let _ = core.start_proxy();
            } else {
                let _ = core.get_proxy_status();
            }

            // Background 2-second CPU/RAM process-tree sampler
            let monitor_core = Arc::clone(&core);
            let monitor_handle = app.handle().clone();
            std::thread::Builder::new()
                .name("devdock-metrics-monitor".to_string())
                .spawn(move || loop {
                    let snapshot = monitor_core.sample_metrics();
                    let _ = monitor_handle.emit("metrics:snapshot", snapshot);
                    std::thread::sleep(DEFAULT_MONITOR_INTERVAL);
                })
                .ok();

            let watcher_state = create_package_json_watcher(app.handle().clone());
            let state = AppState {
                core: Arc::clone(&core),
                watcher: Mutex::new(watcher_state),
                allow_exit: Arc::new(AtomicBool::new(false)),
            };
            state.sync_watchers();

            let tray_menu = build_tray_menu(app.handle(), &core)?;
            let mut tray_builder = TrayIconBuilder::with_id("devdock-tray")
                .menu(&tray_menu)
                .tooltip("DevDock")
                .show_menu_on_left_click(true)
                .on_menu_event(|app_handle, event| {
                    handle_tray_menu_event(app_handle, event.id.as_ref());
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Ok(menu) =
                            build_tray_menu(tray.app_handle(), &tray.app_handle().state::<AppState>().core)
                        {
                            let _ = tray.set_menu(Some(menu));
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let _ = tray_builder.build(app)?;

            app.manage(state);

            // Automated E2E smoke test driver when DEVDOCK_SMOKE_TEST_FIXTURE is set
            if let Ok(fixture_dir) = std::env::var("DEVDOCK_SMOKE_TEST_FIXTURE") {
                if !fixture_dir.trim().is_empty() {
                    let expected_marker = std::env::var("DEVDOCK_SMOKE_TEST_MARKER")
                        .unwrap_or_else(|_| "DEVDOCK_E2E_OK".to_string());
                    let smoke_handle = app.handle().clone();
                    std::thread::Builder::new()
                        .name("devdock-e2e-smoke".to_string())
                        .spawn(move || {
                            run_e2e_smoke_driver(
                                smoke_handle,
                                PathBuf::from(fixture_dir),
                                expected_marker,
                            );
                        })
                        .ok();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if !state.allow_exit.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_bootstrap_info,
            refresh_shell_path,
            get_setting,
            set_setting,
            list_projects,
            register_folder_as_project,
            attach_folder_to_project,
            refresh_service,
            rename_project,
            rename_service,
            set_service_pm_override,
            set_service_node_version_override,
            set_script_auto_restart,
            set_service_default_script,
            reorder_project_services,
            get_project_status,
            start_project_all,
            stop_project_all,
            restart_project_all,
            clean_project_build_caches,
            set_service_port,
            set_service_port_injection,
            ensure_service_port,
            check_service_port,
            assign_next_free_port,
            inspect_listening_ports,
            kill_port_owner,
            inspect_service_node_runtime,
            install_node_version,
            relocate_service,
            remove_service,
            remove_project,
            scan_folder,
            register_grouped_project,
            inspect_service_env,
            write_service_env,
            update_service_env_key,
            list_presets,
            get_preset,
            create_preset,
            update_preset,
            delete_preset,
            attach_preset_to_project,
            detach_preset_from_project,
            reorder_project_presets,
            attach_preset_to_service,
            detach_preset_from_service,
            reorder_service_presets,
            inspect_project_shared_env,
            test_service_db_connection,
            test_project_db_connection,
            analyze_service_storage,
            analyze_project_storage,
            get_cached_global_storage,
            analyze_all_storage,
            clean_service_storage,
            run_service_script,
            stop_process,
            restart_process,
            list_processes,
            get_metrics_snapshot,
            get_process_logs,
            get_project_logs,
            get_all_logs,
            clear_process_logs,
            clear_project_logs,
            export_logs_to_file,
            get_proxy_status,
            set_proxy_enabled,
            preview_hosts_sync,
            sync_etc_hosts,
            open_external_url,
            get_service_git_info,
            get_all_services_git_info,
            get_desktop_tool_settings,
            set_default_editor,
            set_default_terminal,
            open_service_quick_action,
            confirm_app_quit,
            export_config_to_file,
            preview_import_file,
            apply_import_file,
            validate_relocation_folder,
        ])
        .build(tauri::generate_context!())
        .expect("error while building DevDock Tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                let state = app_handle.state::<AppState>();
                if !state.allow_exit.load(Ordering::SeqCst) {
                    let active = state.core.active_process_count();
                    if active > 0 {
                        api.prevent_exit();
                        show_main_window(app_handle);
                        let _ = app_handle.emit(
                            "app:quit-requested",
                            serde_json::json!({ "activeCount": active }),
                        );
                    }
                }
            }
        });
}

fn run_e2e_smoke_driver(app: AppHandle, fixture_dir: PathBuf, expected_marker: String) {
    use std::sync::mpsc;
    use std::time::Duration;

    std::thread::sleep(Duration::from_millis(250));

    let (tx, rx) = mpsc::channel::<String>();
    let marker_clone = expected_marker.clone();
    let listener_id = app.listen("process:log", move |event| {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            if let Some(text) = val.get("text").and_then(|v| v.as_str()) {
                if text.contains(&marker_clone) {
                    let _ = tx.send(text.to_string());
                }
            }
        }
    });

    let state = app.state::<AppState>();
    let result = (|| -> Result<String, String> {
        let project = state
            .core
            .register_folder_as_project(&fixture_dir, Some("SmokeTestProject"))
            .map_err(|e| format!("register_folder_as_project failed: {e}"))?;
        let service = project
            .services
            .first()
            .ok_or_else(|| "SmokeTestProject has no services".to_string())?;
        let proc = state
            .core
            .run_service_script(&service.id, "dev")
            .map_err(|e| format!("run_service_script failed: {e}"))?;

        let observed = rx
            .recv_timeout(Duration::from_secs(12))
            .map_err(|_| "Timed out waiting for live process:log event".to_string())?;

        let _ = state.core.stop_process(&proc.id);
        Ok(observed)
    })();

    app.unlisten(listener_id);
    state.core.stop_all_processes();
    state.allow_exit.store(true, Ordering::SeqCst);

    match result {
        Ok(observed) => {
            println!("[E2E_SMOKE_OK] observed live log: {observed}");
            app.exit(0);
        }
        Err(err) => {
            eprintln!("[E2E_SMOKE_FAIL] {err}");
            app.exit(1);
        }
    }
}
