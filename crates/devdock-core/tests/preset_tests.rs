use devdock_core::models::PresetEntryInput;
use devdock_core::presets::PresetStore;
use devdock_core::traits::{InMemoryNotifier, InMemorySecretStore, InMemoryShellEnvProvider, SecretStore};
use devdock_core::DevDockCore;
use std::collections::BTreeMap;
use std::fs;
use std::sync::Arc;
use tempfile::TempDir;

#[test]
fn preset_crud_and_secret_isolation_from_sqlite() {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("devdock.sqlite");
    let secrets = Arc::new(InMemorySecretStore::new());
    let shell_env = Arc::new(InMemoryShellEnvProvider::new("/usr/bin"));
    let notifier = Arc::new(InMemoryNotifier::new());

    let core = DevDockCore::new(&db_path, secrets.clone(), shell_env, notifier).unwrap();

    // Create preset with 1 plain entry and 1 secret entry
    let created = core
        .create_preset(
            "DB Staging",
            &[
                PresetEntryInput {
                    key: "DB_HOST".to_string(),
                    value: "staging.db.internal".to_string(),
                    is_secret: false,
                },
                PresetEntryInput {
                    key: "DATABASE_URL".to_string(),
                    value: "postgres://admin:super_secret_pw@staging.db.internal:5432/app"
                        .to_string(),
                    is_secret: true,
                },
            ],
        )
        .unwrap();

    assert_eq!(created.name, "DB Staging");
    assert_eq!(created.entries.len(), 2);

    // Verify secret value is stored in SecretStore, NOT in SQLite
    let secret_key = PresetStore::secret_store_key(&created.id, "DATABASE_URL");
    assert_eq!(
        secrets.get(&secret_key).unwrap().as_deref(),
        Some("postgres://admin:super_secret_pw@staging.db.internal:5432/app")
    );

    // Directly inspect raw SQLite file + WAL to ensure secret value is never persisted in plain text
    let mut raw_bytes = fs::read(&db_path).unwrap();
    let wal_path = tmp.path().join("devdock.sqlite-wal");
    if wal_path.is_file() {
        raw_bytes.extend(fs::read(&wal_path).unwrap());
    }
    let raw_db_lossy = String::from_utf8_lossy(&raw_bytes);
    assert!(
        !raw_db_lossy.contains("super_secret_pw"),
        "secret value must never appear in SQLite or WAL file"
    );
    assert!(raw_db_lossy.contains("staging.db.internal"));

    // Update preset: rotate secret, convert plain to secret, remove old key
    let updated = core
        .update_preset(
            &created.id,
            "DB Staging v2",
            &[
                PresetEntryInput {
                    key: "DATABASE_URL".to_string(),
                    value: "postgres://admin:rotated_secret_999@staging.db.internal:5432/app"
                        .to_string(),
                    is_secret: true,
                },
                PresetEntryInput {
                    key: "REDIS_PASSWORD".to_string(),
                    value: "redis_top_secret".to_string(),
                    is_secret: true,
                },
            ],
        )
        .unwrap();

    assert_eq!(updated.name, "DB Staging v2");
    assert_eq!(updated.entries.len(), 2);
    assert_eq!(
        secrets.get(&secret_key).unwrap().as_deref(),
        Some("postgres://admin:rotated_secret_999@staging.db.internal:5432/app")
    );

    let redis_key = PresetStore::secret_store_key(&created.id, "REDIS_PASSWORD");
    assert_eq!(
        secrets.get(&redis_key).unwrap().as_deref(),
        Some("redis_top_secret")
    );

    // Delete preset cleans up secrets from SecretStore
    core.delete_preset(&created.id).unwrap();
    assert!(secrets.get(&secret_key).unwrap().is_none());
    assert!(secrets.get(&redis_key).unwrap().is_none());
    assert!(core.list_presets().unwrap().is_empty());
}

#[test]
fn layered_resolution_precedence_shell_dotenv_project_presets_service_presets_port() {
    let tmp = TempDir::new().unwrap();
    let fe_dir = tmp.path().join("lms-frontend");
    let be_dir = tmp.path().join("lms-backend");
    fs::create_dir_all(&fe_dir).unwrap();
    fs::create_dir_all(&be_dir).unwrap();

    fs::write(fe_dir.join("package.json"), r#"{ "name": "lms-frontend" }"#).unwrap();
    fs::write(be_dir.join("package.json"), r#"{ "name": "lms-backend" }"#).unwrap();

    fs::write(
        be_dir.join(".env.example"),
        "SHELL_ONLY=\nSHARED_KEY=\nDATABASE_URL=\nPORT=\nMISSING_KEY=example\n",
    )
    .unwrap();
    fs::write(
        be_dir.join(".env"),
        "SHARED_KEY=from-dotenv\nDATABASE_URL=postgres://local:local@localhost:5432/dev\nPORT=3000\n",
    )
    .unwrap();

    let db_path = tmp.path().join("devdock.sqlite");
    let secrets = Arc::new(InMemorySecretStore::new());
    let shell_env = Arc::new(InMemoryShellEnvProvider::new("/usr/bin"));
    shell_env.set_env_var("SHELL_ONLY", "from-shell");
    shell_env.set_env_var("SHARED_KEY", "from-shell");
    let notifier = Arc::new(InMemoryNotifier::new());

    let core = DevDockCore::new(&db_path, secrets, shell_env, notifier).unwrap();
    let project = core
        .register_grouped_project("LMS App", &[be_dir.clone(), fe_dir.clone()], None)
        .unwrap();
    let backend_id = &project.services[0].id;
    let frontend_id = &project.services[1].id;

    // Assign DevDock PORT to backend
    core.set_service_port(backend_id, Some(4001)).unwrap();

    let p_base = core
        .create_preset(
            "Project Base",
            &[
                PresetEntryInput {
                    key: "SHARED_KEY".to_string(),
                    value: "from-project-base".to_string(),
                    is_secret: false,
                },
                PresetEntryInput {
                    key: "DATABASE_URL".to_string(),
                    value: "postgres://staging:pw@staging:5432/lms".to_string(),
                    is_secret: true,
                },
                PresetEntryInput {
                    key: "ORDER_TEST".to_string(),
                    value: "first".to_string(),
                    is_secret: false,
                },
                PresetEntryInput {
                    key: "PORT".to_string(),
                    value: "9999".to_string(),
                    is_secret: false,
                },
            ],
        )
        .unwrap();

    let p_override = core
        .create_preset(
            "Project Override",
            &[PresetEntryInput {
                key: "ORDER_TEST".to_string(),
                value: "second".to_string(),
                is_secret: false,
            }],
        )
        .unwrap();

    let s_override = core
        .create_preset(
            "Backend Local",
            &[PresetEntryInput {
                key: "SHARED_KEY".to_string(),
                value: "from-service-preset".to_string(),
                is_secret: false,
            }],
        )
        .unwrap();

    // Attach 2 project presets (p_base then p_override)
    core.attach_preset_to_project(&project.id, &p_base.id)
        .unwrap();
    core.attach_preset_to_project(&project.id, &p_override.id)
        .unwrap();

    // Attach 1 service preset to backend only
    core.attach_preset_to_service(backend_id, &s_override.id)
        .unwrap();

    // Check usage tracking
    let base_fetched = core.get_preset(&p_base.id).unwrap();
    assert_eq!(base_fetched.usages.len(), 1);
    assert_eq!(base_fetched.usages[0].kind, "project");
    assert_eq!(base_fetched.usages[0].name, "LMS App");

    // Inspect backend resolved env
    let be_env = core.inspect_service_env(backend_id, None).unwrap();
    let by_key: BTreeMap<_, _> = be_env.entries.iter().map(|e| (e.key.as_str(), e)).collect();

    // 1. Shell only key (satisfied via shell + present in .env.example)
    assert_eq!(by_key["SHELL_ONLY"].value, "from-shell");
    assert_eq!(by_key["SHELL_ONLY"].source, "shell");
    assert_eq!(by_key["SHELL_ONLY"].layer_kind, "shell");

    // 2. Service preset wins over project preset, .env, and shell
    assert_eq!(by_key["SHARED_KEY"].value, "from-service-preset");
    assert_eq!(by_key["SHARED_KEY"].source, "service:Backend Local");
    assert_eq!(by_key["SHARED_KEY"].layer_kind, "service_preset");
    assert_eq!(
        by_key["SHARED_KEY"].overridden_sources,
        vec!["shell", ".env", "project:Project Base"]
    );

    // 3. Later project preset wins over earlier project preset
    assert_eq!(by_key["ORDER_TEST"].value, "second");
    assert_eq!(by_key["ORDER_TEST"].source, "project:Project Override");
    assert_eq!(
        by_key["ORDER_TEST"].overridden_sources,
        vec!["project:Project Base"]
    );

    // 4. DevDock PORT wins over everything
    assert_eq!(by_key["PORT"].value, "4001");
    assert_eq!(by_key["PORT"].source, "DevDock PORT");
    assert_eq!(by_key["PORT"].layer_kind, "port");
    assert_eq!(
        by_key["PORT"].overridden_sources,
        vec![".env", "project:Project Base"]
    );

    // 5. Secret from project preset is inherited & marked secret
    assert_eq!(
        by_key["DATABASE_URL"].value,
        "postgres://staging:pw@staging:5432/lms"
    );
    assert!(by_key["DATABASE_URL"].is_secret);

    // 6. Missing key from .env.example still reported
    assert_eq!(be_env.missing_keys.len(), 1);
    assert_eq!(be_env.missing_keys[0].key, "MISSING_KEY");

    // 7. Reorder project presets: p_override first, p_base second -> p_base now wins ORDER_TEST
    core.reorder_project_presets(&project.id, &[p_override.id.clone(), p_base.id.clone()])
        .unwrap();
    let after_reorder = core.inspect_service_env(backend_id, None).unwrap();
    let order_entry = after_reorder
        .entries
        .iter()
        .find(|e| e.key == "ORDER_TEST")
        .unwrap();
    assert_eq!(order_entry.value, "first");
    assert_eq!(order_entry.source, "project:Project Base");

    // 8. Frontend inherits project presets without backend's service preset
    let fe_env = core.inspect_service_env(frontend_id, None).unwrap();
    let fe_shared = fe_env
        .entries
        .iter()
        .find(|e| e.key == "SHARED_KEY")
        .unwrap();
    assert_eq!(fe_shared.value, "from-project-base");
    assert_eq!(fe_shared.source, "project:Project Base");

    // 9. Runtime env map includes full shell PATH + resolved overrides without touching repo files
    let runtime = core.resolve_service_runtime_env(backend_id, None).unwrap();
    assert_eq!(runtime.get("PATH").map(String::as_str), Some("/usr/bin"));
    assert_eq!(runtime.get("PORT").map(String::as_str), Some("4001"));
    assert_eq!(
        runtime.get("SHARED_KEY").map(String::as_str),
        Some("from-service-preset")
    );
    // Repo .env untouched
    assert!(fs::read_to_string(be_dir.join(".env"))
        .unwrap()
        .contains("SHARED_KEY=from-dotenv"));

    // 10. Detach service preset restores project preset value
    core.detach_preset_from_service(backend_id, &s_override.id)
        .unwrap();
    let after_detach = core.inspect_service_env(backend_id, None).unwrap();
    let shared_after = after_detach
        .entries
        .iter()
        .find(|e| e.key == "SHARED_KEY")
        .unwrap();
    assert_eq!(shared_after.value, "from-project-base");
}
