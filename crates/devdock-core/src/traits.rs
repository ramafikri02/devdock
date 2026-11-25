use crate::error::CoreResult;
use std::collections::HashMap;
use std::sync::RwLock;

/// Abstraction over OS secret storage (macOS Keychain / Windows Credential Manager).
pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> CoreResult<Option<String>>;
    fn set(&self, key: &str, value: &str) -> CoreResult<()>;
    fn delete(&self, key: &str) -> CoreResult<()>;
}

/// Abstraction over resolving the user's login shell environment and PATH.
pub trait ShellEnvProvider: Send + Sync {
    fn get_path(&self) -> CoreResult<String>;
    fn get_env(&self) -> CoreResult<HashMap<String, String>>;
    fn refresh(&self) -> CoreResult<String>;
}

/// Abstraction over OS desktop notifications.
pub trait Notifier: Send + Sync {
    fn notify(&self, title: &str, body: &str) -> CoreResult<()>;
}

/// In-memory fake implementation of `SecretStore` for core tests.
#[derive(Debug, Default)]
pub struct InMemorySecretStore {
    values: RwLock<HashMap<String, String>>,
}

impl InMemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SecretStore for InMemorySecretStore {
    fn get(&self, key: &str) -> CoreResult<Option<String>> {
        let map = self.values.read().expect("secret store lock poisoned");
        Ok(map.get(key).cloned())
    }

    fn set(&self, key: &str, value: &str) -> CoreResult<()> {
        let mut map = self.values.write().expect("secret store lock poisoned");
        map.insert(key.to_string(), value.to_string());
        Ok(())
    }

    fn delete(&self, key: &str) -> CoreResult<()> {
        let mut map = self.values.write().expect("secret store lock poisoned");
        map.remove(key);
        Ok(())
    }
}

/// In-memory fake implementation of `ShellEnvProvider` for core tests.
#[derive(Debug)]
pub struct InMemoryShellEnvProvider {
    path: RwLock<String>,
    env: RwLock<HashMap<String, String>>,
    refresh_count: RwLock<usize>,
}

impl InMemoryShellEnvProvider {
    pub fn new(initial_path: impl Into<String>) -> Self {
        let path_str = initial_path.into();
        let mut env = HashMap::new();
        env.insert("PATH".to_string(), path_str.clone());
        Self {
            path: RwLock::new(path_str),
            env: RwLock::new(env),
            refresh_count: RwLock::new(0),
        }
    }

    pub fn set_path(&self, new_path: impl Into<String>) {
        let p = new_path.into();
        *self.path.write().expect("path lock poisoned") = p.clone();
        self.env
            .write()
            .expect("env lock poisoned")
            .insert("PATH".to_string(), p);
    }

    pub fn set_env_var(&self, key: impl Into<String>, value: impl Into<String>) {
        self.env
            .write()
            .expect("env lock poisoned")
            .insert(key.into(), value.into());
    }

    pub fn refresh_count(&self) -> usize {
        *self.refresh_count.read().expect("refresh count lock poisoned")
    }
}

impl ShellEnvProvider for InMemoryShellEnvProvider {
    fn get_path(&self) -> CoreResult<String> {
        Ok(self.path.read().expect("path lock poisoned").clone())
    }

    fn get_env(&self) -> CoreResult<HashMap<String, String>> {
        Ok(self.env.read().expect("env lock poisoned").clone())
    }

    fn refresh(&self) -> CoreResult<String> {
        *self.refresh_count.write().expect("refresh count lock poisoned") += 1;
        self.get_path()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordedNotification {
    pub title: String,
    pub body: String,
}

/// In-memory fake implementation of `Notifier` for core tests.
#[derive(Debug, Default)]
pub struct InMemoryNotifier {
    sent: RwLock<Vec<RecordedNotification>>,
}

impl InMemoryNotifier {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn notifications(&self) -> Vec<RecordedNotification> {
        self.sent.read().expect("notifier lock poisoned").clone()
    }
}

impl Notifier for InMemoryNotifier {
    fn notify(&self, title: &str, body: &str) -> CoreResult<()> {
        self.sent
            .write()
            .expect("notifier lock poisoned")
            .push(RecordedNotification {
                title: title.to_string(),
                body: body.to_string(),
            });
        Ok(())
    }
}
