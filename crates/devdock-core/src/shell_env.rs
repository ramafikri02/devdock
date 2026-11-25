use crate::error::CoreResult;
use crate::traits::ShellEnvProvider;
use std::collections::HashMap;
use std::process::Command;
use std::sync::RwLock;

/// Resolves the user's login shell PATH so GUI-launched desktop apps on macOS/Linux
/// can locate tools installed via Homebrew, fnm, nvm, volta, pnpm, etc.
#[derive(Debug)]
pub struct LoginShellEnvProvider {
    cached_env: RwLock<Option<HashMap<String, String>>>,
}

impl Default for LoginShellEnvProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl LoginShellEnvProvider {
    pub fn new() -> Self {
        Self {
            cached_env: RwLock::new(None),
        }
    }

    fn resolve_now() -> HashMap<String, String> {
        let mut env: HashMap<String, String> = std::env::vars().collect();

        #[cfg(unix)]
        {
            if let Some(shell_path) = Self::probe_unix_login_shell_path() {
                if !shell_path.trim().is_empty() {
                    env.insert("PATH".to_string(), shell_path);
                }
            }
        }

        env
    }

    #[cfg(unix)]
    fn probe_unix_login_shell_path() -> Option<String> {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        // Use a marker so profile/rc chatter before PATH output is ignored.
        let marker = "__DEVDOCK_PATH__=";
        let cmd_str = format!("printf '%s%s\\n' '{marker}' \"$PATH\"");

        let output = Command::new(&shell)
            .args(["-ilc", &cmd_str])
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines().rev() {
            if let Some(rest) = line.strip_prefix(marker) {
                let trimmed = rest.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
        None
    }

    fn ensure_loaded(&self) -> HashMap<String, String> {
        if let Some(existing) = self.cached_env.read().expect("env lock poisoned").clone() {
            return existing;
        }
        let resolved = Self::resolve_now();
        *self.cached_env.write().expect("env lock poisoned") = Some(resolved.clone());
        resolved
    }
}

impl ShellEnvProvider for LoginShellEnvProvider {
    fn get_path(&self) -> CoreResult<String> {
        let env = self.ensure_loaded();
        Ok(env.get("PATH").cloned().unwrap_or_default())
    }

    fn get_env(&self) -> CoreResult<HashMap<String, String>> {
        Ok(self.ensure_loaded())
    }

    fn refresh(&self) -> CoreResult<String> {
        let resolved = Self::resolve_now();
        let path = resolved.get("PATH").cloned().unwrap_or_default();
        *self.cached_env.write().expect("env lock poisoned") = Some(resolved);
        Ok(path)
    }
}
