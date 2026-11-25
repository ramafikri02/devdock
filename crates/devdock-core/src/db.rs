use crate::error::CoreResult;
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MIGRATION_0001: &str = r#"
CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    adapter TEXT NOT NULL,
    start_order INTEGER NOT NULL DEFAULT 0,
    default_script TEXT,
    pm_override TEXT,
    port INTEGER,
    port_injection TEXT,
    node_version_override TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_service_project_id ON service(project_id);

CREATE TABLE IF NOT EXISTS preset (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preset_entry (
    id TEXT PRIMARY KEY,
    preset_id TEXT NOT NULL REFERENCES preset(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    is_secret INTEGER NOT NULL DEFAULT 0,
    value TEXT,
    UNIQUE(preset_id, key)
);

CREATE TABLE IF NOT EXISTS project_preset (
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    preset_id TEXT NOT NULL REFERENCES preset(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (project_id, preset_id)
);

CREATE TABLE IF NOT EXISTS service_preset (
    service_id TEXT NOT NULL REFERENCES service(id) ON DELETE CASCADE,
    preset_id TEXT NOT NULL REFERENCES preset(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (service_id, preset_id)
);

CREATE TABLE IF NOT EXISTS script_setting (
    service_id TEXT NOT NULL REFERENCES service(id) ON DELETE CASCADE,
    script_name TEXT NOT NULL,
    auto_restart INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (service_id, script_name)
);

CREATE TABLE IF NOT EXISTS setting (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

pub struct Database {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl Database {
    pub fn open(path: &Path) -> CoreResult<Self> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Mutex::new(conn),
            path: path.to_path_buf(),
        };
        db.configure_and_migrate()?;
        Ok(db)
    }

    pub fn open_in_memory() -> CoreResult<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: Mutex::new(conn),
            path: PathBuf::from(":memory:"),
        };
        db.configure_and_migrate()?;
        Ok(db)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> CoreResult<T>) -> CoreResult<T> {
        let conn = self.conn.lock().expect("database lock poisoned");
        f(&conn)
    }

    pub fn schema_version(&self) -> CoreResult<i32> {
        self.with_conn(|conn| {
            let version: i32 = conn.query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )?;
            Ok(version)
        })
    }

    fn configure_and_migrate(&self) -> CoreResult<()> {
        let conn = self.conn.lock().expect("database lock poisoned");
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS schema_migrations (
                 version INTEGER PRIMARY KEY,
                 applied_at TEXT NOT NULL
             );",
        )?;

        let current_version: i32 = conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;

        let migrations: &[(i32, &str)] = &[(1, MIGRATION_0001)];

        for &(version, sql) in migrations {
            if version > current_version {
                conn.execute_batch(sql)?;
                conn.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                    params![version, chrono::Utc::now().to_rfc3339()],
                )?;
            }
        }

        Ok(())
    }
}
