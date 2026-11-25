use devdock_core::db_tester::DbConnectionTester;
use devdock_core::models::DbKind;
use devdock_core::DevDockCore;
use std::fs;
use std::net::TcpListener;
use std::process::Command;
use std::time::Duration;
use tempfile::TempDir;

#[test]
fn detects_db_urls_from_schemes_and_common_keys() {
    assert_eq!(
        DbConnectionTester::detect_db_kind(
            "DATABASE_URL",
            "postgres://admin:secret@localhost:5432/devdock"
        ),
        Some(DbKind::Postgres)
    );
    assert_eq!(
        DbConnectionTester::detect_db_kind(
            "CUSTOM_PG",
            "postgresql://user:pass@127.0.0.1:5432/app"
        ),
        Some(DbKind::Postgres)
    );
    assert_eq!(
        DbConnectionTester::detect_db_kind("MYSQL_URL", "mysql://root:pw@localhost:3306/shop"),
        Some(DbKind::Mysql)
    );
    assert_eq!(
        DbConnectionTester::detect_db_kind("DB_URI", "mariadb://root:pw@localhost:3306/shop"),
        Some(DbKind::Mysql)
    );
    assert_eq!(
        DbConnectionTester::detect_db_kind(
            "MONGO_URI",
            "mongodb+srv://user:pw@cluster0.example.net/mydb"
        ),
        Some(DbKind::Mongodb)
    );
    assert_eq!(
        DbConnectionTester::detect_db_kind("CACHE_CONN", "rediss://:pw@cache.internal:6379/0"),
        Some(DbKind::Redis)
    );
    // Key-name inference for bare host:port
    assert_eq!(
        DbConnectionTester::detect_db_kind("REDIS_URL", "127.0.0.1:6379"),
        Some(DbKind::Redis)
    );
    // Non-DB URLs should not match
    assert_eq!(
        DbConnectionTester::detect_db_kind("API_URL", "https://api.example.com"),
        None
    );
    assert_eq!(DbConnectionTester::detect_db_kind("PORT", "3000"), None);
}

#[test]
fn parses_targets_and_sanitizes_credentials_from_errors() {
    let parsed = DbConnectionTester::parse_target(
        "DATABASE_URL",
        "mariadb://admin:TopSecret99!@db.internal:3306/lms_prod",
    )
    .unwrap();
    assert_eq!(parsed.kind, DbKind::Mysql);
    assert!(parsed.normalized_url.starts_with("mysql://"));
    assert_eq!(parsed.display_target, "db.internal:3306/lms_prod");
    assert!(!parsed.display_target.contains("TopSecret99!"));
    assert!(!parsed.display_target.contains("admin"));

    let raw_url = "postgres://admin:UltraSecretPass123@127.0.0.1:5432/app";
    let raw_err = format!(
        "failed to connect to {raw_url}: password authentication failed for password UltraSecretPass123"
    );
    let sanitized = DbConnectionTester::sanitize_error(&raw_err, raw_url);
    assert!(!sanitized.contains("UltraSecretPass123"));
    assert!(!sanitized.contains("admin:UltraSecretPass123"));
}

#[tokio::test]
async fn connection_refused_returns_clean_error_without_leaking_credentials() {
    // Bind and immediately drop a local port so we get an unused port that refuses connections
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let unused_port = listener.local_addr().unwrap().port();
    drop(listener);

    let url = format!("redis://:SuperSecretRedisPw@127.0.0.1:{unused_port}/0");
    let res =
        DbConnectionTester::test_connection("REDIS_URL", &url, Duration::from_secs(2)).await;

    assert!(!res.ok);
    assert_eq!(res.kind, DbKind::Redis);
    assert_eq!(res.display_target, format!("127.0.0.1:{unused_port}/0"));
    let err = res.error.expect("expected error message");
    assert!(!err.is_empty());
    assert!(!err.contains("SuperSecretRedisPw"));
}

#[tokio::test]
async fn service_env_inspection_flags_detected_db_keys() {
    let tmp = TempDir::new().unwrap();
    let app_dir = tmp.path().join("api");
    fs::create_dir_all(&app_dir).unwrap();
    fs::write(app_dir.join("package.json"), r#"{ "name": "api" }"#).unwrap();
    fs::write(
        app_dir.join(".env"),
        "DATABASE_URL=postgres://u:p@localhost:5432/db\nREDIS_URL=redis://localhost:6379\nAPP_NAME=api\n",
    )
    .unwrap();

    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();
    let project = core.register_folder_as_project(&app_dir, None).unwrap();
    let service_id = &project.services[0].id;

    let env = core.inspect_service_env(service_id, None).unwrap();
    let db = env.entries.iter().find(|e| e.key == "DATABASE_URL").unwrap();
    let redis = env.entries.iter().find(|e| e.key == "REDIS_URL").unwrap();
    let app = env.entries.iter().find(|e| e.key == "APP_NAME").unwrap();

    assert_eq!(db.detected_db_kind, Some(DbKind::Postgres));
    assert_eq!(redis.detected_db_kind, Some(DbKind::Redis));
    assert_eq!(app.detected_db_kind, None);
}

/// Optional Docker-backed integration test.
/// Run explicitly with: `cargo test -p devdock-core --test db_tester_tests -- --ignored`
/// Skips cleanly if Docker daemon is unavailable.
#[tokio::test]
#[ignore = "requires local Docker daemon and image pull"]
async fn docker_backed_real_redis_connection_check() {
    let docker_ok = Command::new("docker")
        .arg("info")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !docker_ok {
        eprintln!("Docker not available; skipping docker_backed_real_redis_connection_check");
        return;
    }

    let container_name = format!("devdock-test-redis-{}", uuid::Uuid::new_v4());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let host_port = listener.local_addr().unwrap().port();
    drop(listener);

    let start = Command::new("docker")
        .args([
            "run",
            "-d",
            "--rm",
            "--name",
            &container_name,
            "-p",
            &format!("127.0.0.1:{host_port}:6379"),
            "redis:7-alpine",
            "redis-server",
            "--requirepass",
            "testpass",
        ])
        .output()
        .expect("failed to start redis container");
    assert!(start.status.success(), "docker run failed");

    // Wait briefly for redis to accept connections
    tokio::time::sleep(Duration::from_secs(2)).await;

    let ok_res = DbConnectionTester::test_connection(
        "REDIS_URL",
        &format!("redis://:testpass@127.0.0.1:{host_port}/0"),
        Duration::from_secs(5),
    )
    .await;

    let bad_auth = DbConnectionTester::test_connection(
        "REDIS_URL",
        &format!("redis://:wrongpass@127.0.0.1:{host_port}/0"),
        Duration::from_secs(5),
    )
    .await;

    let _ = Command::new("docker")
        .args(["rm", "-f", &container_name])
        .output();

    assert!(ok_res.ok, "expected Redis PING to succeed: {:?}", ok_res.error);
    assert!(!bad_auth.ok, "expected wrong Redis password to fail");
    assert!(!bad_auth.error.unwrap_or_default().contains("wrongpass"));
}
