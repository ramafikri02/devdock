use devdock_core::error::CoreError;
use devdock_core::DevDockCore;
use std::collections::BTreeMap;
use std::fs;
use tempfile::TempDir;

#[test]
fn resolves_dotenv_priority_order_and_source_attribution() {
    let tmp = TempDir::new().unwrap();
    let app_dir = tmp.path().join("api-service");
    fs::create_dir_all(&app_dir).unwrap();
    fs::write(
        app_dir.join("package.json"),
        r#"{ "name": "api-service", "scripts": { "dev": "node index.js" } }"#,
    )
    .unwrap();

    fs::write(
        app_dir.join(".env"),
        "# base config\nAPP_NAME=ApiBase\nPORT=3000\nJWT_SECRET=base-secret\n",
    )
    .unwrap();
    fs::write(
        app_dir.join(".env.local"),
        "export APP_NAME=\"Api Local\"\nLOCAL_ONLY=true # inline comment\n",
    )
    .unwrap();
    fs::write(
        app_dir.join(".env.development"),
        "PORT=4000\nDEBUG='verbose mode'\n",
    )
    .unwrap();
    fs::write(
        app_dir.join(".env.development.local"),
        "PORT=4001\nDATABASE_URL=postgres://user:pass@localhost:5432/dev\n",
    )
    .unwrap();

    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();
    let project = core.register_folder_as_project(&app_dir, None).unwrap();
    let service_id = &project.services[0].id;

    let inspection = core.inspect_service_env(service_id, Some("development")).unwrap();
    assert_eq!(inspection.mode, "development");
    assert_eq!(inspection.files.len(), 4);
    assert!(inspection.files.iter().all(|f| f.exists));

    let by_key: BTreeMap<_, _> = inspection
        .entries
        .iter()
        .map(|e| (e.key.as_str(), e))
        .collect();

    assert_eq!(by_key["APP_NAME"].value, "Api Local");
    assert_eq!(by_key["APP_NAME"].source, ".env.local");
    assert_eq!(by_key["APP_NAME"].overridden_sources, vec![".env"]);

    assert_eq!(by_key["PORT"].value, "4001");
    assert_eq!(by_key["PORT"].source, ".env.development.local");
    assert_eq!(
        by_key["PORT"].overridden_sources,
        vec![".env", ".env.development"]
    );

    assert_eq!(by_key["LOCAL_ONLY"].value, "true");
    assert_eq!(by_key["DEBUG"].value, "verbose mode");

    // Secret detection
    assert!(by_key["JWT_SECRET"].is_secret);
    assert!(by_key["DATABASE_URL"].is_secret);
    assert!(!by_key["PORT"].is_secret);
    assert!(!by_key["APP_NAME"].is_secret);
}

#[test]
fn diffs_against_env_example_for_missing_and_unknown_keys() {
    let tmp = TempDir::new().unwrap();
    let app_dir = tmp.path().join("web-service");
    fs::create_dir_all(&app_dir).unwrap();
    fs::write(
        app_dir.join("package.json"),
        r#"{ "name": "web-service" }"#,
    )
    .unwrap();

    fs::write(
        app_dir.join(".env.example"),
        "NEXT_PUBLIC_API_URL=http://localhost:4000\nSTRIPE_SECRET_KEY=sk_test_xxx\nSENTRY_DSN=\n",
    )
    .unwrap();
    fs::write(
        app_dir.join(".env"),
        "NEXT_PUBLIC_API_URL=http://localhost:4001\nTYPO_EXTRA_KEY=123\n",
    )
    .unwrap();

    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();
    let project = core.register_folder_as_project(&app_dir, None).unwrap();
    let service_id = &project.services[0].id;

    let inspection = core.inspect_service_env(service_id, None).unwrap();
    assert!(inspection.has_example_file);

    let missing_names: Vec<&str> = inspection
        .missing_keys
        .iter()
        .map(|m| m.key.as_str())
        .collect();
    assert_eq!(missing_names, vec!["SENTRY_DSN", "STRIPE_SECRET_KEY"]);
    assert!(
        inspection
            .missing_keys
            .iter()
            .find(|m| m.key == "STRIPE_SECRET_KEY")
            .unwrap()
            .is_secret
    );

    let known = inspection
        .entries
        .iter()
        .find(|e| e.key == "NEXT_PUBLIC_API_URL")
        .unwrap();
    assert!(!known.is_unknown);

    let unknown = inspection
        .entries
        .iter()
        .find(|e| e.key == "TYPO_EXTRA_KEY")
        .unwrap();
    assert!(unknown.is_unknown);
}

#[test]
fn writes_env_file_safely_with_backup_and_rejects_unsafe_targets() {
    let tmp = TempDir::new().unwrap();
    let app_dir = tmp.path().join("worker-service");
    fs::create_dir_all(&app_dir).unwrap();
    fs::write(
        app_dir.join("package.json"),
        r#"{ "name": "worker-service" }"#,
    )
    .unwrap();
    fs::write(app_dir.join(".env"), "OLD_KEY=old_val\nKEEP=1\n").unwrap();

    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();
    let project = core.register_folder_as_project(&app_dir, None).unwrap();
    let service_id = &project.services[0].id;

    // 1. Inline single-key update creates .env.bak
    let update_res = core
        .update_service_env_key(service_id, ".env", "OLD_KEY", "new value with space")
        .unwrap();
    assert_eq!(update_res.target_file, ".env");
    let bak_path = update_res.backup_path.expect("expected .env.bak backup");
    assert!(bak_path.ends_with(".env.bak"));
    assert_eq!(
        fs::read_to_string(&bak_path).unwrap(),
        "OLD_KEY=old_val\nKEEP=1\n"
    );

    let after_update = core.inspect_service_env(service_id, None).unwrap();
    assert_eq!(
        after_update
            .entries
            .iter()
            .find(|e| e.key == "OLD_KEY")
            .unwrap()
            .value,
        "new value with space"
    );

    // 2. Full write to .env creates/overwrites .env.bak with previous state
    let mut new_entries = BTreeMap::new();
    new_entries.insert("PORT".to_string(), "5050".to_string());
    new_entries.insert("API_TOKEN".to_string(), "tok_live_999".to_string());
    let write_res = core
        .write_service_env(service_id, ".env", &new_entries)
        .unwrap();
    assert_eq!(write_res.written_keys, 2);
    assert!(write_res.backup_path.is_some());

    let after_write = core.inspect_service_env(service_id, None).unwrap();
    assert_eq!(after_write.entries.len(), 2);
    assert_eq!(
        after_write
            .entries
            .iter()
            .find(|e| e.key == "PORT")
            .unwrap()
            .value,
        "5050"
    );

    // 3. Rejects path traversal and .env.example
    assert!(matches!(
        core.write_service_env(service_id, "../.env", &new_entries),
        Err(CoreError::Validation(_))
    ));
    assert!(matches!(
        core.write_service_env(service_id, ".env.example", &new_entries),
        Err(CoreError::Validation(_))
    ));
}

#[test]
fn strips_backticks_and_inline_comments_after_quoted_values() {
    let tmp = TempDir::new().unwrap();
    let app_dir = tmp.path().join("lms-backend");
    fs::create_dir_all(&app_dir).unwrap();
    fs::write(
        app_dir.join("package.json"),
        r#"{ "name": "backend", "scripts": { "dev": "tsx watch src/index.ts" } }"#,
    )
    .unwrap();

    fs::write(
        app_dir.join(".env"),
        concat!(
            "DATABASE_URL=`mysql://root:secret@localhost:3306/lms_dev`\n",
            "BACKTICK_WITH_COMMENT=`hello \"world\" 'ok'` # trailing comment\n",
            "DOUBLE_WITH_COMMENT=\"value \\\"quoted\\\"\" # trailing comment\n",
            "SINGLE_WITH_COMMENT='single value' # trailing comment\n",
        ),
    )
    .unwrap();

    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();
    let project = core.register_folder_as_project(&app_dir, None).unwrap();
    let service_id = &project.services[0].id;

    let inspection = core.inspect_service_env(service_id, None).unwrap();
    let by_key: BTreeMap<_, _> = inspection
        .entries
        .iter()
        .map(|e| (e.key.as_str(), e))
        .collect();

    assert_eq!(
        by_key["DATABASE_URL"].value,
        "mysql://root:secret@localhost:3306/lms_dev"
    );
    assert_eq!(
        by_key["BACKTICK_WITH_COMMENT"].value,
        "hello \"world\" 'ok'"
    );
    assert_eq!(by_key["DOUBLE_WITH_COMMENT"].value, "value \"quoted\"");
    assert_eq!(by_key["SINGLE_WITH_COMMENT"].value, "single value");
}
