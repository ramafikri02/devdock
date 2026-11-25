use devdock_core::error::CoreError;
use devdock_core::models::{Framework, PackageManager};
use devdock_core::DevDockCore;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn create_node_fixture(
    root: &Path,
    dir_name: &str,
    pkg_json: &str,
    lockfile: Option<&str>,
) -> std::path::PathBuf {
    let dir = root.join(dir_name);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("package.json"), pkg_json).unwrap();
    if let Some(lf) = lockfile {
        fs::write(dir.join(lf), "").unwrap();
    }
    dir
}

#[test]
fn detects_package_managers_and_frameworks_across_fixtures() {
    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();
    let tmp = TempDir::new().unwrap();

    let next_pnpm = create_node_fixture(
        tmp.path(),
        "web",
        r#"{
            "name": "lms-frontend",
            "dependencies": { "next": "15.0.0", "react": "19.0.0" },
            "scripts": { "dev": "next dev", "build": "next build" }
        }"#,
        Some("pnpm-lock.yaml"),
    );

    let nest_yarn = create_node_fixture(
        tmp.path(),
        "api",
        r#"{
            "name": "lms-backend",
            "dependencies": { "@nestjs/core": "10.0.0" },
            "scripts": { "start:dev": "nest start --watch" }
        }"#,
        Some("yarn.lock"),
    );

    let vite_bun = create_node_fixture(
        tmp.path(),
        "admin",
        r#"{
            "name": "admin-panel",
            "packageManager": "bun@1.1.30",
            "devDependencies": { "vite": "6.0.0" },
            "scripts": { "dev": "vite" }
        }"#,
        Some("package-lock.json"), // packageManager field should win over lockfile
    );

    let express_npm = create_node_fixture(
        tmp.path(),
        "worker",
        r#"{
            "name": "express-worker",
            "dependencies": { "express": "4.21.0" },
            "scripts": { "start": "node index.js" }
        }"#,
        Some("package-lock.json"),
    );

    let d1 = core.describe_folder(&next_pnpm).unwrap();
    assert_eq!(d1.package_manager, PackageManager::Pnpm);
    assert_eq!(d1.framework, Framework::NextJs);
    assert_eq!(d1.scripts.len(), 2);

    let d2 = core.describe_folder(&nest_yarn).unwrap();
    assert_eq!(d2.package_manager, PackageManager::Yarn);
    assert_eq!(d2.framework, Framework::NestJs);

    let d3 = core.describe_folder(&vite_bun).unwrap();
    assert_eq!(d3.package_manager, PackageManager::Bun);
    assert_eq!(d3.framework, Framework::Vite);

    let d4 = core.describe_folder(&express_npm).unwrap();
    assert_eq!(d4.package_manager, PackageManager::Npm);
    assert_eq!(d4.framework, Framework::Express);
}

#[test]
fn register_attach_prevent_duplicates_rename_override_and_remove_safely() {
    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();
    let tmp = TempDir::new().unwrap();

    let fe = create_node_fixture(
        tmp.path(),
        "lms-frontend",
        r#"{
            "name": "lms-frontend",
            "dependencies": { "next": "15.0.0" },
            "scripts": { "dev": "next dev" }
        }"#,
        Some("pnpm-lock.yaml"),
    );
    let be = create_node_fixture(
        tmp.path(),
        "lms-backend",
        r#"{
            "name": "lms-backend",
            "dependencies": { "express": "4.21.0" },
            "scripts": { "dev": "tsx watch src/index.ts" }
        }"#,
        Some("npm-shrinkwrap.json"),
    );

    // Register first folder as new project
    let project = core
        .register_folder_as_project(&fe, Some("LMS App"))
        .expect("should register project");
    assert_eq!(project.name, "LMS App");
    assert_eq!(project.services.len(), 1);
    assert_eq!(project.services[0].name, "lms-frontend");

    // Duplicate path rejected
    let dup = core.register_folder_as_project(&fe, Some("Dup"));
    assert!(matches!(dup, Err(CoreError::DuplicatePath(_))));

    // Attach second folder to existing project
    let attached = core
        .attach_folder_to_project(&project.id, &be, None)
        .expect("should attach service");
    assert_eq!(attached.name, "lms-backend");
    assert_eq!(attached.start_order, 1);

    let projects = core.list_projects().unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].services.len(), 2);

    // Rename project & service
    let renamed_proj = core.rename_project(&project.id, "LMS Platform").unwrap();
    assert_eq!(renamed_proj.name, "LMS Platform");

    let renamed_svc = core.rename_service(&attached.id, "LMS API").unwrap();
    assert_eq!(renamed_svc.name, "LMS API");

    // Override package manager
    let overridden = core
        .set_service_pm_override(&attached.id, Some(PackageManager::Pnpm))
        .unwrap();
    assert_eq!(overridden.pm_override, Some(PackageManager::Pnpm));

    // Clear override
    let cleared = core.set_service_pm_override(&attached.id, None).unwrap();
    assert_eq!(cleared.pm_override, None);

    // Remove one service without touching disk
    core.remove_service(&attached.id).unwrap();
    assert!(be.join("package.json").is_file(), "disk files must remain untouched");
    assert_eq!(core.get_project(&project.id).unwrap().services.len(), 1);

    // Remove project without touching disk
    core.remove_project(&project.id).unwrap();
    assert!(fe.join("package.json").is_file(), "disk files must remain untouched");
    assert!(core.list_projects().unwrap().is_empty());
}

#[test]
fn refreshes_scripts_when_package_json_changes_and_handles_missing_folder_relocation() {
    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();
    let tmp = TempDir::new().unwrap();

    let app_dir = create_node_fixture(
        tmp.path(),
        "landing-page",
        r#"{
            "name": "landing-page",
            "devDependencies": { "astro": "5.0.0" },
            "scripts": { "dev": "astro dev" }
        }"#,
        Some("pnpm-lock.yaml"),
    );

    let project = core.register_folder_as_project(&app_dir, None).unwrap();
    let service_id = project.services[0].id.clone();
    assert_eq!(project.services[0].scripts.len(), 1);
    assert!(!project.services[0].is_missing);

    // Edit package.json on disk
    fs::write(
        app_dir.join("package.json"),
        r#"{
            "name": "landing-page",
            "devDependencies": { "astro": "5.0.0" },
            "scripts": { "dev": "astro dev", "build": "astro build", "preview": "astro preview" }
        }"#,
    )
    .unwrap();

    let refreshed = core.refresh_service(&service_id).unwrap();
    assert_eq!(refreshed.scripts.len(), 3);
    assert_eq!(
        refreshed.scripts.get("preview").map(String::as_str),
        Some("astro preview")
    );

    // Move folder on disk -> should be flagged missing
    let moved_dir = tmp.path().join("landing-page-moved");
    fs::rename(&app_dir, &moved_dir).unwrap();

    let missing_svc = core.get_service(&service_id).unwrap();
    assert!(missing_svc.is_missing, "moved folder should be flagged missing");

    // Relocate service to moved folder -> no longer missing
    let relocated = core.relocate_service(&service_id, &moved_dir).unwrap();
    assert!(!relocated.is_missing);
    assert_eq!(relocated.scripts.len(), 3);
}
