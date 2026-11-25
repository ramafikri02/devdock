use devdock_core::models::{
    AppBootstrapInfo, EnvWriteResult, GlobalStorageSummary, PackageManager, Project,
    ProjectStorageSummary, ScanResult, Service, ServiceEnvInspection, ServiceStorageReport,
    StorageCleanResult,
};
use devdock_core::traits::{InMemoryNotifier, InMemorySecretStore};
use devdock_core::DevDockCore;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

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
    state: State<'_, AppState>,
    folder: String,
    project_name: Option<String>,
) -> Result<Project, String> {
    let project = state
        .core
        .register_folder_as_project(PathBuf::from(folder).as_path(), project_name.as_deref())
        .map_err(|e| e.to_string())?;
    state.sync_watchers();
    Ok(project)
}

#[tauri::command]
fn attach_folder_to_project(
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
fn remove_service(state: State<'_, AppState>, service_id: String) -> Result<(), String> {
    state
        .core
        .remove_service(&service_id)
        .map_err(|e| e.to_string())?;
    state.sync_watchers();
    Ok(())
}

#[tauri::command]
fn remove_project(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    state
        .core
        .remove_project(&project_id)
        .map_err(|e| e.to_string())?;
    state.sync_watchers();
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
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve OS app data directory");
            let db_path = data_dir.join("devdock.sqlite");

            let core = DevDockCore::open_desktop(
                &db_path,
                Arc::new(InMemorySecretStore::new()),
                Arc::new(InMemoryNotifier::new()),
            )
            .expect("failed to initialize DevDock core");

            let watcher_state = create_package_json_watcher(app.handle().clone());
            let state = AppState {
                core: Arc::new(core),
                watcher: Mutex::new(watcher_state),
            };
            state.sync_watchers();

            app.manage(state);
            Ok(())
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
            relocate_service,
            remove_service,
            remove_project,
            scan_folder,
            register_grouped_project,
            inspect_service_env,
            write_service_env,
            update_service_env_key,
            analyze_service_storage,
            analyze_project_storage,
            get_cached_global_storage,
            analyze_all_storage,
            clean_service_storage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DevDock Tauri application");
}
