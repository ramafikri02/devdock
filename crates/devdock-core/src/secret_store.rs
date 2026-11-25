use crate::error::{CoreError, CoreResult};
use crate::traits::SecretStore;

const SERVICE_NAME: &str = "com.devdock.app";

/// Production `SecretStore` backed by the OS credential store
/// (macOS Keychain / Windows Credential Manager) via `keyring`.
#[derive(Debug, Default)]
pub struct OsKeychainSecretStore {
    service_name: String,
}

impl OsKeychainSecretStore {
    pub fn new() -> Self {
        Self {
            service_name: SERVICE_NAME.to_string(),
        }
    }

    pub fn with_service_name(service_name: impl Into<String>) -> Self {
        Self {
            service_name: service_name.into(),
        }
    }
}

impl SecretStore for OsKeychainSecretStore {
    fn get(&self, key: &str) -> CoreResult<Option<String>> {
        let entry = keyring::Entry::new(&self.service_name, key)
            .map_err(|e| CoreError::SecretStore(format!("failed to create keychain entry: {e}")))?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(CoreError::SecretStore(format!(
                "failed to read secret from OS keychain: {e}"
            ))),
        }
    }

    fn set(&self, key: &str, value: &str) -> CoreResult<()> {
        let entry = keyring::Entry::new(&self.service_name, key)
            .map_err(|e| CoreError::SecretStore(format!("failed to create keychain entry: {e}")))?;
        entry
            .set_password(value)
            .map_err(|e| CoreError::SecretStore(format!("failed to store secret in OS keychain: {e}")))
    }

    fn delete(&self, key: &str) -> CoreResult<()> {
        let entry = keyring::Entry::new(&self.service_name, key)
            .map_err(|e| CoreError::SecretStore(format!("failed to create keychain entry: {e}")))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(CoreError::SecretStore(format!(
                "failed to delete secret from OS keychain: {e}"
            ))),
        }
    }
}
