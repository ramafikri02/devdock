use devdock_core::export_import::{
    detect_common_parent, remap_path_prefix, validate_relocated_folder,
};
use devdock_core::models::PresetEntryInput;
use devdock_core::DevDockCore;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn write_service_fixture(dir: &Path, pkg_name: &str) {
    fs::create_dir_all(dir).expect("create service dir");
    let pkg = format!(
        r#"{{
  "name": "{pkg_name}",
  "version": "1.0.0",
  "scripts": {{ "dev": "node -v" }}
}}"#
    );
    fs::write(dir.join("package.json"), pkg).expect("write package.json");
}

#[test]
fn round_trip_export_and_import_preserves_projects_presets_encrypted_secrets_and_settings() {
    let temp = TempDir::new().expect("tempdir");
    let fe_dir = temp.path().join("H2o").join("lms-frontend");
    let be_dir = temp.path().join("H2o").join("lms-backend");
    write_service_fixture(&fe_dir, "@lms/frontend");
    write_service_fixture(&be_dir, "@lms/backend");

    let src = DevDockCore::in_memory_for_tests("/usr/bin:/bin").expect("src core");
    src.set_setting("theme", "light").unwrap();
    src.set_setting("default_editor", "cursor").unwrap();

    let project = src
        .register_grouped_project("LMS App", &[be_dir.clone(), fe_dir.clone()], None)
        .expect("register grouped");
    let be = &project.services[0];
    let fe = &project.services[1];

    src.set_service_port(&be.id, Some(4001)).unwrap();
    src.set_service_port(&fe.id, Some(3002)).unwrap();
    src.set_script_auto_restart(&be.id, "dev", true).unwrap();

    let preset = src
        .create_preset(
            "DB Staging",
            &[
                PresetEntryInput {
                    key: "NODE_ENV".into(),
                    value: "staging".into(),
                    is_secret: false,
                },
                PresetEntryInput {
                    key: "DATABASE_URL".into(),
                    value: "postgres://user:supersecret@db.internal:5432/lms".into(),
                    is_secret: true,
                },
            ],
        )
        .expect("create preset");
    src.attach_preset_to_project(&project.id, &preset.id)
        .expect("attach preset");

    let export_file = temp.path().join("backup.devdock.json");
    let summary = src
        .export_config_to_file(&export_file, true, Some("my-strong-passphrase"))
        .expect("export");
    assert_eq!(summary.project_count, 1);
    assert_eq!(summary.service_count, 2);
    assert_eq!(summary.secret_count, 1);
    assert!(summary.includes_secrets);

    // Ensure secret plaintext does NOT leak into the exported JSON file
    let raw_json = fs::read_to_string(&export_file).unwrap();
    assert!(!raw_json.contains("supersecret"));

    // Wrong passphrase must fail
    let dest = DevDockCore::in_memory_for_tests("/usr/bin:/bin").expect("dest core");
    let wrong_preview = dest
        .preview_import_bundle(&raw_json, Some("wrong-pass"), None, &HashMap::new())
        .expect("preview");
    assert!(!wrong_preview.passphrase_verified);
    assert!(dest
        .apply_import_bundle(&raw_json, Some("wrong-pass"), None, &HashMap::new())
        .is_err());

    // Unsupported formatVersion must be rejected
    let bad_version = raw_json.replace("\"formatVersion\": 1", "\"formatVersion\": 99");
    assert!(dest
        .preview_import_bundle(&bad_version, Some("my-strong-passphrase"), None, &HashMap::new())
        .is_err());

    // Valid passphrase imports everything including destination SecretStore
    let preview = dest
        .preview_import_bundle(&raw_json, Some("my-strong-passphrase"), None, &HashMap::new())
        .expect("preview valid");
    assert!(preview.passphrase_verified);
    assert_eq!(preview.missing_count, 0);

    let applied = dest
        .apply_import_bundle(&raw_json, Some("my-strong-passphrase"), None, &HashMap::new())
        .expect("apply");
    assert_eq!(applied.projects_imported, 1);
    assert_eq!(applied.services_imported, 2);
    assert_eq!(applied.secrets_stored, 1);

    assert_eq!(dest.get_setting("theme").unwrap().as_deref(), Some("light"));
    assert_eq!(
        dest.get_setting("default_editor").unwrap().as_deref(),
        Some("cursor")
    );

    let imported_projects = dest.list_projects().unwrap();
    assert_eq!(imported_projects.len(), 1);
    let imported_be = &imported_projects[0].services[0];
    assert_eq!(imported_be.port, Some(4001));
    assert_eq!(imported_be.auto_restart_scripts, vec!["dev".to_string()]);

    let env = dest.inspect_service_env(&imported_be.id, None).unwrap();
    let db_entry = env
        .entries
        .iter()
        .find(|e| e.key == "DATABASE_URL")
        .expect("DATABASE_URL restored via SecretStore");
    assert_eq!(
        db_entry.value,
        "postgres://user:supersecret@db.internal:5432/lms"
    );
    assert!(db_entry.is_secret);

    // Export with include_secrets = false omits encryptedSecrets completely
    let no_secrets_json = src.export_config_bundle(false, None).expect("export no secrets");
    assert!(!no_secrets_json.contains("\"encryptedSecrets\": {"));
}

#[test]
fn cross_os_common_parent_remapping_and_package_name_validation() {
    let win_paths = vec![
        r"D:\code\H2o\lms-backend".to_string(),
        r"D:\code\H2o\lms-frontend".to_string(),
    ];
    assert_eq!(
        detect_common_parent(&win_paths).as_deref(),
        Some(r"D:\code\H2o")
    );

    let remapped_to_posix = remap_path_prefix(
        r"D:\code\H2o\lms-backend",
        r"D:\code\H2o",
        "/Users/fikri/H2o",
    );
    assert_eq!(remapped_to_posix, "/Users/fikri/H2o/lms-backend");

    let remapped_to_win = remap_path_prefix(
        "/Users/fikri/H2o/lms-frontend",
        "/Users/fikri/H2o",
        r"D:\code\H2o",
    );
    assert_eq!(remapped_to_win, r"D:\code\H2o\lms-frontend");

    // End-to-end import with bulk parent remap + individual override + package.json check
    let temp = TempDir::new().expect("tempdir");
    let new_root = temp.path().join("migrated");
    let reloc_fe = new_root.join("lms-frontend");
    let wrong_pkg_dir = temp.path().join("wrong-folder");
    write_service_fixture(&reloc_fe, "@lms/frontend");
    write_service_fixture(&wrong_pkg_dir, "something-else");

    let check_ok = validate_relocated_folder(&reloc_fe, Some("@lms/frontend"));
    assert!(check_ok.exists);
    assert!(check_ok.matches_package_name);
    assert!(check_ok.warning.is_none());

    let check_mismatch = validate_relocated_folder(&wrong_pkg_dir, Some("@lms/backend"));
    assert!(check_mismatch.exists);
    assert!(!check_mismatch.matches_package_name);
    assert!(check_mismatch.warning.is_some());

    // Construct an export bundle referencing Windows paths & test bulk remap to local temp dir
    let bundle_json = serde_json::json!({
        "formatVersion": 1,
        "exportedAt": "2026-11-25T00:00:00Z",
        "sourceOs": "windows",
        "includesSecrets": false,
        "settings": {},
        "presets": [],
        "encryptedSecrets": null,
        "projects": [{
            "name": "Migrated LMS",
            "rootPath": null,
            "presets": [],
            "services": [{
                "name": "lms-frontend",
                "path": "D:\\code\\H2o\\lms-frontend",
                "adapter": "node",
                "packageName": "@lms/frontend",
                "startOrder": 0,
                "defaultScript": "dev",
                "pmOverride": null,
                "port": 3002,
                "portInjection": null,
                "nodeVersionOverride": null,
                "autoRestartScripts": [],
                "presets": []
            }]
        }]
    })
    .to_string();

    let dest = DevDockCore::in_memory_for_tests("/usr/bin:/bin").expect("dest");
    let preview_missing = dest
        .preview_import_bundle(&bundle_json, None, None, &HashMap::new())
        .unwrap();
    assert_eq!(preview_missing.missing_count, 1);
    assert_eq!(
        preview_missing.suggested_common_parent.as_deref(),
        Some(r"D:\code\H2o")
    );

    let new_root_str = new_root.to_string_lossy().to_string();
    let preview_remapped = dest
        .preview_import_bundle(
            &bundle_json,
            None,
            Some((r"D:\code\H2o", &new_root_str)),
            &HashMap::new(),
        )
        .unwrap();
    assert_eq!(preview_remapped.missing_count, 0);
    assert!(preview_remapped.services[0].exists_on_disk);
    assert!(preview_remapped.services[0].package_name_matches);
}
