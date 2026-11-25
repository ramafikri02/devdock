use crate::error::{CoreError, CoreResult};
use crate::models::{DetectedTool, DesktopToolSettings};
use crate::process_manager::resolve_program_in_path;
use std::path::Path;
use std::process::Command;

struct ToolCandidate {
    id: &'static str,
    name: &'static str,
    command: &'static str,
    #[allow(dead_code)]
    macos_app: Option<&'static str>,
}

const EDITOR_CANDIDATES: &[ToolCandidate] = &[
    ToolCandidate {
        id: "cursor",
        name: "Cursor",
        command: "cursor",
        macos_app: Some("Cursor.app"),
    },
    ToolCandidate {
        id: "code",
        name: "VS Code",
        command: "code",
        macos_app: Some("Visual Studio Code.app"),
    },
    ToolCandidate {
        id: "zed",
        name: "Zed",
        command: "zed",
        macos_app: Some("Zed.app"),
    },
    ToolCandidate {
        id: "windsurf",
        name: "Windsurf",
        command: "windsurf",
        macos_app: Some("Windsurf.app"),
    },
    ToolCandidate {
        id: "webstorm",
        name: "WebStorm",
        command: "webstorm",
        macos_app: Some("WebStorm.app"),
    },
    ToolCandidate {
        id: "subl",
        name: "Sublime Text",
        command: "subl",
        macos_app: Some("Sublime Text.app"),
    },
];

#[cfg(target_os = "macos")]
const TERMINAL_CANDIDATES: &[ToolCandidate] = &[
    ToolCandidate {
        id: "ghostty",
        name: "Ghostty",
        command: "ghostty",
        macos_app: Some("Ghostty.app"),
    },
    ToolCandidate {
        id: "warp",
        name: "Warp",
        command: "warp",
        macos_app: Some("Warp.app"),
    },
    ToolCandidate {
        id: "iterm",
        name: "iTerm2",
        command: "iTerm",
        macos_app: Some("iTerm.app"),
    },
    ToolCandidate {
        id: "wezterm",
        name: "WezTerm",
        command: "wezterm",
        macos_app: Some("WezTerm.app"),
    },
    ToolCandidate {
        id: "kitty",
        name: "kitty",
        command: "kitty",
        macos_app: Some("kitty.app"),
    },
    ToolCandidate {
        id: "terminal",
        name: "Terminal.app",
        command: "Terminal",
        macos_app: Some("Terminal.app"),
    },
];

#[cfg(windows)]
const TERMINAL_CANDIDATES: &[ToolCandidate] = &[
    ToolCandidate {
        id: "wt",
        name: "Windows Terminal",
        command: "wt",
        macos_app: None,
    },
    ToolCandidate {
        id: "pwsh",
        name: "PowerShell 7",
        command: "pwsh",
        macos_app: None,
    },
    ToolCandidate {
        id: "cmd",
        name: "Command Prompt",
        command: "cmd",
        macos_app: None,
    },
];

#[cfg(all(unix, not(target_os = "macos")))]
const TERMINAL_CANDIDATES: &[ToolCandidate] = &[
    ToolCandidate {
        id: "ghostty",
        name: "Ghostty",
        command: "ghostty",
        macos_app: None,
    },
    ToolCandidate {
        id: "wezterm",
        name: "WezTerm",
        command: "wezterm",
        macos_app: None,
    },
    ToolCandidate {
        id: "kitty",
        name: "kitty",
        command: "kitty",
        macos_app: None,
    },
    ToolCandidate {
        id: "gnome-terminal",
        name: "GNOME Terminal",
        command: "gnome-terminal",
        macos_app: None,
    },
];

fn is_tool_available(candidate: &ToolCandidate, path_env: &str) -> bool {
    let resolved = resolve_program_in_path(candidate.command, path_env);
    if resolved.is_file() {
        return true;
    }

    #[cfg(target_os = "macos")]
    if let Some(app_name) = candidate.macos_app {
        let sys_app = Path::new("/Applications").join(app_name);
        let sys_util = Path::new("/System/Applications/Utilities").join(app_name);
        if sys_app.exists() || sys_util.exists() {
            return true;
        }
        if let Ok(home) = std::env::var("HOME") {
            if Path::new(&home).join("Applications").join(app_name).exists() {
                return true;
            }
        }
    }

    false
}

pub fn detect_tools(
    path_env: &str,
    saved_editor: Option<String>,
    saved_terminal: Option<String>,
) -> DesktopToolSettings {
    let detected_editors: Vec<DetectedTool> = EDITOR_CANDIDATES
        .iter()
        .map(|c| DetectedTool {
            id: c.id.to_string(),
            name: c.name.to_string(),
            command: c.command.to_string(),
            available: is_tool_available(c, path_env),
        })
        .collect();

    let detected_terminals: Vec<DetectedTool> = TERMINAL_CANDIDATES
        .iter()
        .map(|c| DetectedTool {
            id: c.id.to_string(),
            name: c.name.to_string(),
            command: c.command.to_string(),
            available: is_tool_available(c, path_env),
        })
        .collect();

    let default_editor = saved_editor
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            detected_editors
                .iter()
                .find(|t| t.available)
                .map(|t| t.id.clone())
        });

    let default_terminal = saved_terminal
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            detected_terminals
                .iter()
                .find(|t| t.available)
                .map(|t| t.id.clone())
        });

    DesktopToolSettings {
        default_editor,
        default_terminal,
        detected_editors,
        detected_terminals,
    }
}

pub fn open_folder_in_editor(
    folder: &Path,
    editor_id: Option<&str>,
    path_env: &str,
) -> CoreResult<()> {
    if !folder.is_dir() {
        return Err(CoreError::InvalidFolder(format!(
            "Folder does not exist: {}",
            folder.display()
        )));
    }

    let settings = detect_tools(path_env, editor_id.map(ToString::to_string), None);
    let chosen_id = settings.default_editor.unwrap_or_else(|| "code".to_string());
    let candidate = EDITOR_CANDIDATES.iter().find(|c| c.id == chosen_id);

    let command_name = candidate.map(|c| c.command).unwrap_or(&chosen_id);
    let resolved = resolve_program_in_path(command_name, path_env);
    if resolved.is_file() {
        Command::new(resolved)
            .arg(folder)
            .spawn()
            .map_err(CoreError::Io)?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    if let Some(app_name) = candidate.and_then(|c| c.macos_app) {
        Command::new("open")
            .args(["-a", app_name])
            .arg(folder)
            .spawn()
            .map_err(CoreError::Io)?;
        return Ok(());
    }

    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", command_name])
            .arg(folder)
            .spawn()
            .map_err(CoreError::Io)?;
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        Err(CoreError::Adapter(format!(
            "Editor '{chosen_id}' tidak ditemukan di PATH atau /Applications"
        )))
    }
}

pub fn open_folder_in_terminal(
    folder: &Path,
    terminal_id: Option<&str>,
    path_env: &str,
) -> CoreResult<()> {
    if !folder.is_dir() {
        return Err(CoreError::InvalidFolder(format!(
            "Folder does not exist: {}",
            folder.display()
        )));
    }

    let settings = detect_tools(path_env, None, terminal_id.map(ToString::to_string));
    let chosen_id = settings
        .default_terminal
        .unwrap_or_else(|| "terminal".to_string());

    #[cfg(target_os = "macos")]
    {
        let app_name = TERMINAL_CANDIDATES
            .iter()
            .find(|c| c.id == chosen_id)
            .and_then(|c| c.macos_app)
            .unwrap_or("Terminal.app");
        Command::new("open")
            .args(["-a", app_name])
            .arg(folder)
            .spawn()
            .map_err(CoreError::Io)?;
        Ok(())
    }

    #[cfg(windows)]
    {
        match chosen_id.as_str() {
            "wt" => {
                Command::new("wt")
                    .args(["-d"])
                    .arg(folder)
                    .spawn()
                    .map_err(CoreError::Io)?;
            }
            "pwsh" => {
                Command::new("cmd")
                    .args(["/C", "start", "pwsh", "-NoExit", "-WorkingDirectory"])
                    .arg(folder)
                    .spawn()
                    .map_err(CoreError::Io)?;
            }
            _ => {
                Command::new("cmd")
                    .args(["/C", "start", "cmd", "/K", "cd", "/d"])
                    .arg(folder)
                    .spawn()
                    .map_err(CoreError::Io)?;
            }
        }
        Ok(())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let cmd_name = TERMINAL_CANDIDATES
            .iter()
            .find(|c| c.id == chosen_id)
            .map(|c| c.command)
            .unwrap_or("x-terminal-emulator");
        let resolved = resolve_program_in_path(cmd_name, path_env);
        Command::new(resolved)
            .current_dir(folder)
            .spawn()
            .map_err(CoreError::Io)?;
        Ok(())
    }
}

pub fn open_folder_in_file_manager(folder: &Path) -> CoreResult<()> {
    if !folder.is_dir() {
        return Err(CoreError::InvalidFolder(format!(
            "Folder does not exist: {}",
            folder.display()
        )));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(folder)
            .spawn()
            .map_err(CoreError::Io)?;
    }
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(folder)
            .spawn()
            .map_err(CoreError::Io)?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(folder)
            .spawn()
            .map_err(CoreError::Io)?;
    }
    Ok(())
}
