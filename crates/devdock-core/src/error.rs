use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json parse error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("duplicate path: {0}")]
    DuplicatePath(String),

    #[error("invalid folder: {0}")]
    InvalidFolder(String),

    #[error("adapter error: {0}")]
    Adapter(String),

    #[error("shell env error: {0}")]
    ShellEnv(String),

    #[error("secret store error: {0}")]
    SecretStore(String),

    #[error("validation error: {0}")]
    Validation(String),
}

pub type CoreResult<T> = Result<T, CoreError>;
