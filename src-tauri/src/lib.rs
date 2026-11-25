use devdock_core::models::AppBootstrapInfo;
use devdock_core::traits::{InMemoryNotifier, InMemorySecretStore};
use devdock_core::DevDockCore;
use std::sync::Arc;
use tauri::{Manager, State};

pub struct AppState {
    pub core: Arc<DevDockCore>,
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

            // Keychain & OS notification real adapters are wired in Wave 2B & Wave 4.
            let core = DevDockCore::open_desktop(
                &db_path,
                Arc::new(InMemorySecretStore::new()),
                Arc::new(InMemoryNotifier::new()),
            )
            .expect("failed to initialize DevDock core");

            app.manage(AppState {
                core: Arc::new(core),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_bootstrap_info,
            refresh_shell_path,
            get_setting,
            set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DevDock Tauri application");
}
