use devdock_core::error::CoreError;
use devdock_core::models::StorageEntryKind;
use devdock_core::DevDockCore;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn write_sized_file(path: &Path, size: usize) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, vec![b'x'; size]).unwrap();
}

#[test]
fn computes_accurate_storage_breakdown_caching_and_project_aggregation() {
    let tmp = TempDir::new().unwrap();
    let fe = tmp.path().join("lms-frontend");
    let be = tmp.path().join("lms-backend");

    fs::create_dir_all(&fe).unwrap();
    fs::write(fe.join("package.json"), r#"{ "name": "lms-frontend" }"#).unwrap();
    write_sized_file(&fe.join("src/index.tsx"), 500);
    write_sized_file(&fe.join("node_modules/react/index.js"), 4_000);
    write_sized_file(&fe.join(".next/static/chunk.js"), 2_000);

    fs::create_dir_all(&be).unwrap();
    fs::write(be.join("package.json"), r#"{ "name": "lms-backend" }"#).unwrap();
    write_sized_file(&be.join("src/main.ts"), 300);
    write_sized_file(&be.join("node_modules/express/index.js"), 3_000);
    write_sized_file(&be.join("dist/main.js"), 1_000);

    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();
    let project = core
        .register_grouped_project("LMS App", &[fe.clone(), be.clone()], None)
        .unwrap();
    let fe_id = &project.services[0].id;

    // First call calculates from disk
    let report1 = core.analyze_service_storage(fe_id, false).unwrap();
    assert!(!report1.from_cache);
    assert_eq!(report1.node_modules_bytes, 4_000);
    assert_eq!(report1.build_cache_bytes, 2_000);
    assert_eq!(report1.reclaimable_bytes, 6_000);
    assert!(report1.source_bytes >= 500);
    assert_eq!(
        report1.total_bytes,
        report1.node_modules_bytes + report1.build_cache_bytes + report1.source_bytes
    );
    assert_eq!(report1.cleanable_folders.len(), 2);
    assert_eq!(report1.cleanable_folders[0].name, "node_modules");
    assert_eq!(report1.cleanable_folders[0].kind, StorageEntryKind::NodeModules);
    assert_eq!(report1.cleanable_folders[1].name, ".next");
    assert_eq!(report1.cleanable_folders[1].kind, StorageEntryKind::BuildCache);

    // Second call without force_refresh returns cached report
    let report2 = core.analyze_service_storage(fe_id, false).unwrap();
    assert!(report2.from_cache);
    assert_eq!(report2.node_modules_bytes, 4_000);

    // Add more bytes and force_refresh recalculates
    write_sized_file(&fe.join("node_modules/extra/file.js"), 1_500);
    let report3 = core.analyze_service_storage(fe_id, true).unwrap();
    assert!(!report3.from_cache);
    assert_eq!(report3.node_modules_bytes, 5_500);

    // Project aggregation & global summary
    let proj_summary = core.analyze_project_storage(&project.id, false).unwrap();
    assert_eq!(proj_summary.node_modules_bytes, 5_500 + 3_000);
    assert_eq!(proj_summary.build_cache_bytes, 2_000 + 1_000);
    assert_eq!(proj_summary.reclaimable_bytes, 11_500);

    let global = core.get_cached_global_storage().unwrap();
    assert_eq!(global.service_count, 2);
    assert_eq!(global.cached_service_count, 2);
    assert_eq!(global.node_modules_bytes, 8_500);
    assert_eq!(global.reclaimable_bytes, 11_500);
}

#[test]
fn safe_cleanup_deletes_only_allowed_targets_and_updates_cache() {
    let tmp = TempDir::new().unwrap();
    let app_dir = tmp.path().join("clean-app");
    fs::create_dir_all(&app_dir).unwrap();
    fs::write(app_dir.join("package.json"), r#"{ "name": "clean-app" }"#).unwrap();
    write_sized_file(&app_dir.join("src/app.ts"), 600);
    write_sized_file(&app_dir.join("node_modules/pkg/index.js"), 5_000);
    write_sized_file(&app_dir.join("dist/bundle.js"), 2_500);

    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();
    let project = core.register_folder_as_project(&app_dir, None).unwrap();
    let service_id = &project.services[0].id;

    // Reject disallowed targets
    assert!(matches!(
        core.clean_service_storage(service_id, "src"),
        Err(CoreError::Validation(_))
    ));
    assert!(matches!(
        core.clean_service_storage(service_id, ".git"),
        Err(CoreError::Validation(_))
    ));
    assert!(matches!(
        core.clean_service_storage(service_id, "../clean-app"),
        Err(CoreError::Validation(_))
    ));
    assert!(app_dir.join("src/app.ts").is_file());

    // Delete dist
    let clean_dist = core.clean_service_storage(service_id, "dist").unwrap();
    assert_eq!(clean_dist.deleted_folder, "dist");
    assert_eq!(clean_dist.freed_bytes, 2_500);
    assert!(!app_dir.join("dist").exists());
    assert_eq!(clean_dist.updated_report.build_cache_bytes, 0);
    assert_eq!(clean_dist.updated_report.node_modules_bytes, 5_000);

    // Delete node_modules
    let clean_nm = core
        .clean_service_storage(service_id, "node_modules")
        .unwrap();
    assert_eq!(clean_nm.freed_bytes, 5_000);
    assert!(!app_dir.join("node_modules").exists());
    assert_eq!(clean_nm.updated_report.reclaimable_bytes, 0);
    assert!(app_dir.join("src/app.ts").is_file());
}
