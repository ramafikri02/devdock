use crate::models::{DbKind, DbTestResult};
use mongodb::bson::doc;
use mongodb::options::ClientOptions;
use mongodb::Client as MongoClient;
use sqlx::mysql::{MySqlConnectOptions, MySqlConnection};
use sqlx::postgres::{PgConnectOptions, PgConnection};
use sqlx::{Connection, Executor};
use std::str::FromStr;
use std::time::{Duration, Instant};
use url::Url;

pub const DEFAULT_DB_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDbTarget {
    pub kind: DbKind,
    pub normalized_url: String,
    pub display_target: String,
}

pub struct DbConnectionTester;

impl DbConnectionTester {
    /// Auto-detects whether an env key/value pair represents a supported database URL
    /// from URL schemes (`postgres://`, `postgresql://`, `mysql://`, `mariadb://`,
    /// `mongodb://`, `mongodb+srv://`, `redis://`, `rediss://`) or common key names.
    pub fn detect_db_kind(key: &str, value: &str) -> Option<DbKind> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return None;
        }

        if let Some(kind) = Self::kind_from_scheme(trimmed) {
            return Some(kind);
        }

        // Fallback: infer from well-known key names when value looks like host:port
        if !trimmed.contains("://") && Self::looks_like_host_port(trimmed) {
            let upper = key.trim().to_ascii_uppercase();
            if upper.contains("POSTGRES") || upper == "PG_URL" || upper == "PGURL" {
                return Some(DbKind::Postgres);
            }
            if upper.contains("MYSQL") || upper.contains("MARIADB") {
                return Some(DbKind::Mysql);
            }
            if upper.contains("MONGO") {
                return Some(DbKind::Mongodb);
            }
            if upper.contains("REDIS") {
                return Some(DbKind::Redis);
            }
        }

        None
    }

    fn kind_from_scheme(value: &str) -> Option<DbKind> {
        let lower = value.to_ascii_lowercase();
        if lower.starts_with("postgres://") || lower.starts_with("postgresql://") {
            Some(DbKind::Postgres)
        } else if lower.starts_with("mysql://") || lower.starts_with("mariadb://") {
            Some(DbKind::Mysql)
        } else if lower.starts_with("mongodb://") || lower.starts_with("mongodb+srv://") {
            Some(DbKind::Mongodb)
        } else if lower.starts_with("redis://") || lower.starts_with("rediss://") {
            Some(DbKind::Redis)
        } else {
            None
        }
    }

    fn looks_like_host_port(value: &str) -> bool {
        if value.contains(char::is_whitespace) {
            return false;
        }
        if let Some((host, rest)) = value.split_once(':') {
            let port_part = rest.split('/').next().unwrap_or("");
            !host.is_empty() && port_part.parse::<u16>().is_ok()
        } else {
            false
        }
    }

    /// Parses and normalizes a DB URL and returns a credential-free `display_target`.
    pub fn parse_target(key: &str, raw_url: &str) -> Result<ParsedDbTarget, String> {
        let trimmed = raw_url.trim();
        let kind = Self::detect_db_kind(key, trimmed).ok_or_else(|| {
            "URL database tidak dikenali (didukung: postgres://, mysql://, mongodb://, redis://)"
                .to_string()
        })?;

        let with_scheme = if trimmed.contains("://") {
            trimmed.to_string()
        } else {
            let prefix = match kind {
                DbKind::Postgres => "postgres://",
                DbKind::Mysql => "mysql://",
                DbKind::Mongodb => "mongodb://",
                DbKind::Redis => "redis://",
            };
            format!("{prefix}{trimmed}")
        };

        // Normalize mariadb:// -> mysql:// for sqlx driver compatibility
        let normalized_url = if with_scheme.to_ascii_lowercase().starts_with("mariadb://") {
            format!("mysql://{}", &with_scheme["mariadb://".len()..])
        } else {
            with_scheme
        };

        let parsed = Url::parse(&normalized_url)
            .map_err(|_| "Format URL database tidak valid".to_string())?;
        if parsed.host_str().is_none() {
            return Err("Host database tidak ditemukan pada URL".to_string());
        }

        let display_target = Self::format_display_target(&parsed);
        Ok(ParsedDbTarget {
            kind,
            normalized_url,
            display_target,
        })
    }

    /// Formats a sanitized `host[:port][/db]` string without ever including username/password.
    pub fn format_display_target(url: &Url) -> String {
        let host = url.host_str().unwrap_or("localhost");
        let port_part = url.port().map(|p| format!(":{p}")).unwrap_or_default();
        let path = url.path();
        let path_part = if path.is_empty() || path == "/" {
            String::new()
        } else {
            path.to_string()
        };
        format!("{host}{port_part}{path_part}")
    }

    /// Redacts credentials (passwords, userinfo, and raw connection URLs) from error messages.
    pub fn sanitize_error(raw_error: &str, raw_url: &str) -> String {
        let mut msg = raw_error.replace(raw_url.trim(), "<redacted-url>");

        if let Ok(parsed) = Url::parse(raw_url.trim()) {
            if let Some(pw) = parsed.password() {
                if !pw.is_empty() {
                    msg = msg.replace(pw, "***");
                    if let Ok(decoded) = url::form_urlencoded::parse(pw.as_bytes())
                        .map(|(k, _)| k.into_owned())
                        .next()
                        .ok_or(())
                    {
                        if !decoded.is_empty() {
                            msg = msg.replace(&decoded, "***");
                        }
                    }
                }
            }
        }

        // Scrub any remaining scheme://user:pass@ patterns
        for scheme in [
            "postgres://",
            "postgresql://",
            "mysql://",
            "mariadb://",
            "mongodb://",
            "mongodb+srv://",
            "redis://",
            "rediss://",
        ] {
            while let Some(start) = msg.find(scheme) {
                let after = &msg[start + scheme.len()..];
                let end_of_token = after
                    .find(|c: char| c.is_whitespace() || c == '\'' || c == '"' || c == ')')
                    .unwrap_or(after.len());
                let token = &after[..end_of_token];
                if let Some(at_idx) = token.find('@') {
                    let replace_start = start + scheme.len();
                    let replace_end = replace_start + at_idx + 1;
                    msg.replace_range(replace_start..replace_end, "***@");
                } else {
                    break;
                }
            }
        }

        // Keep message concise and single-line friendly
        let single_line = msg
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join(" — ");

        if single_line.len() > 240 {
            format!("{}…", &single_line[..240])
        } else {
            single_line
        }
    }

    /// Runs a real level-2 database connectivity check (authenticate + `SELECT 1` / `PING`)
    /// with a bounded timeout.
    pub async fn test_connection(key: &str, raw_url: &str, timeout: Duration) -> DbTestResult {
        let started = Instant::now();
        let target = match Self::parse_target(key, raw_url) {
            Ok(t) => t,
            Err(err) => {
                return DbTestResult {
                    key: key.to_string(),
                    kind: Self::detect_db_kind(key, raw_url).unwrap_or(DbKind::Postgres),
                    ok: false,
                    latency_ms: started.elapsed().as_millis() as u64,
                    server_info: None,
                    error: Some(err),
                    display_target: String::new(),
                };
            }
        };

        let check_future = async {
            match target.kind {
                DbKind::Postgres => Self::check_postgres(&target.normalized_url).await,
                DbKind::Mysql => Self::check_mysql(&target.normalized_url).await,
                DbKind::Mongodb => Self::check_mongodb(&target.normalized_url, timeout).await,
                DbKind::Redis => Self::check_redis(&target.normalized_url).await,
            }
        };

        let outcome = match tokio::time::timeout(timeout, check_future).await {
            Ok(res) => res,
            Err(_) => Err(format!(
                "Connection timed out after {}s",
                timeout.as_secs()
            )),
        };

        let latency_ms = started.elapsed().as_millis() as u64;

        match outcome {
            Ok(server_info) => DbTestResult {
                key: key.to_string(),
                kind: target.kind,
                ok: true,
                latency_ms,
                server_info: Some(server_info),
                error: None,
                display_target: target.display_target,
            },
            Err(raw_err) => DbTestResult {
                key: key.to_string(),
                kind: target.kind,
                ok: false,
                latency_ms,
                server_info: None,
                error: Some(Self::sanitize_error(&raw_err, raw_url)),
                display_target: target.display_target,
            },
        }
    }

    async fn check_postgres(url: &str) -> Result<String, String> {
        let opts = PgConnectOptions::from_str(url).map_err(|e| e.to_string())?;
        let mut conn = PgConnection::connect_with(&opts)
            .await
            .map_err(|e| e.to_string())?;
        conn.execute("SELECT 1").await.map_err(|e| e.to_string())?;
        let version: Option<String> = sqlx::query_scalar("SHOW server_version")
            .fetch_optional(&mut conn)
            .await
            .ok()
            .flatten();
        let _ = conn.close().await;
        match version {
            Some(v) => {
                let short = v.split_whitespace().next().unwrap_or(&v);
                Ok(format!("PostgreSQL {short}"))
            }
            None => Ok("PostgreSQL".to_string()),
        }
    }

    async fn check_mysql(url: &str) -> Result<String, String> {
        let opts = MySqlConnectOptions::from_str(url).map_err(|e| e.to_string())?;
        let mut conn = MySqlConnection::connect_with(&opts)
            .await
            .map_err(|e| e.to_string())?;
        conn.execute("SELECT 1").await.map_err(|e| e.to_string())?;
        let version: Option<String> = sqlx::query_scalar("SELECT VERSION()")
            .fetch_optional(&mut conn)
            .await
            .ok()
            .flatten();
        let _ = conn.close().await;
        match version {
            Some(v) => {
                let short = v.split('-').next().unwrap_or(&v);
                let label = if v.to_ascii_lowercase().contains("mariadb") {
                    "MariaDB"
                } else {
                    "MySQL"
                };
                Ok(format!("{label} {short}"))
            }
            None => Ok("MySQL".to_string()),
        }
    }

    async fn check_mongodb(url: &str, timeout: Duration) -> Result<String, String> {
        let mut opts = ClientOptions::parse(url).await.map_err(|e| e.to_string())?;
        opts.connect_timeout = Some(timeout);
        opts.server_selection_timeout = Some(timeout);
        let db_name = opts
            .default_database
            .clone()
            .unwrap_or_else(|| "admin".to_string());
        let client = MongoClient::with_options(opts).map_err(|e| e.to_string())?;
        client
            .database(&db_name)
            .run_command(doc! { "ping": 1 })
            .await
            .map_err(|e| e.to_string())?;
        Ok("MongoDB".to_string())
    }

    async fn check_redis(url: &str) -> Result<String, String> {
        let client = redis::Client::open(url).map_err(|e| e.to_string())?;
        let mut conn = client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| e.to_string())?;
        let pong: String = redis::cmd("PING")
            .query_async(&mut conn)
            .await
            .map_err(|e| e.to_string())?;
        Ok(format!("Redis ({pong})"))
    }
}
