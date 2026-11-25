use devdock_core::models::{Framework, PackageManager, ScanCandidateKind};
use devdock_core::DevDockCore;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn write_pkg(dir: &Path, json: &str) {
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join("package.json"), json).unwrap();
}

#[test]
fn scanner_respects_depth_limit_and_ignore_rules() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    // Depth 1: valid project
    write_pkg(
        &root.join("app-one"),
        r#"{ "name": "app-one", "scripts": { "dev": "vite" }, "devDependencies": { "vite": "6.0.0" } }"#,
    );

    // Depth 2: valid project
    write_pkg(
        &root.join("group/app-two"),
        r#"{ "name": "app-two", "scripts": { "dev": "next dev" }, "dependencies": { "next": "15.0.0" } }"#,
    );

    // Depth 4: beyond default depth 3
    write_pkg(
        &root.join("a/b/c/deep-app"),
        r#"{ "name": "deep-app", "scripts": { "start": "node index.js" } }"#,
    );

    // Ignored directories should never be scanned
    write_pkg(
        &root.join("node_modules/some-dep"),
        r#"{ "name": "some-dep" }"#,
    );
    write_pkg(&root.join(".git/hooks-pkg"), r#"{ "name": "hooks-pkg" }"#);
    write_pkg(&root.join("dist/built-pkg"), r#"{ "name": "built-pkg" }"#);
    write_pkg(&root.join(".next/cache-pkg"), r#"{ "name": "cache-pkg" }"#);

    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();

    // Default depth 3 finds app-one and app-two, skips ignored dirs and depth-4 deep-app
    let result = core.scan_folder(root, None).unwrap();
    assert_eq!(result.max_depth, 3);
    let names: Vec<&str> = result.candidates.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["app-one", "app-two"]);

    // Depth 1 only finds app-one
    let shallow = core.scan_folder(root, Some(1)).unwrap();
    let shallow_names: Vec<&str> = shallow.candidates.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(shallow_names, vec!["app-one"]);

    // Depth 4 finds deep-app as well
    let deep = core.scan_folder(root, Some(4)).unwrap();
    let deep_names: Vec<&str> = deep.candidates.iter().map(|c| c.name.as_str()).collect();
    assert!(deep_names.contains(&"deep-app"));
    assert!(!deep_names.contains(&"some-dep"));
    assert!(!deep_names.contains(&"built-pkg"));
}

#[test]
fn scanner_detects_npm_and_pnpm_monorepos_as_single_project_candidates() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    // 1. pnpm-workspace.yaml monorepo
    let pnpm_mono = root.join("h2o-platform");
    write_pkg(
        &pnpm_mono,
        r#"{ "name": "h2o-platform", "private": true, "packageManager": "pnpm@9.15.0" }"#,
    );
    fs::write(
        pnpm_mono.join("pnpm-workspace.yaml"),
        "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
    )
    .unwrap();
    write_pkg(
        &pnpm_mono.join("apps/web"),
        r#"{ "name": "@h2o/web", "dependencies": { "next": "15.0.0" }, "scripts": { "dev": "next dev" } }"#,
    );
    write_pkg(
        &pnpm_mono.join("apps/api"),
        r#"{ "name": "@h2o/api", "dependencies": { "express": "4.21.0" }, "scripts": { "dev": "tsx watch src/index.ts" } }"#,
    );

    // 2. npm/yarn workspaces monorepo
    let npm_mono = root.join("shop-suite");
    write_pkg(
        &npm_mono,
        r#"{ "name": "shop-suite", "private": true, "workspaces": { "packages": ["services/*"] } }"#,
    );
    fs::write(npm_mono.join("yarn.lock"), "").unwrap();
    write_pkg(
        &npm_mono.join("services/storefront"),
        r#"{ "name": "storefront", "devDependencies": { "vite": "6.0.0" }, "scripts": { "dev": "vite" } }"#,
    );

    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();
    let res = core.scan_folder(root, None).unwrap();

    // Only 2 monorepo candidates, workspace packages are NOT emitted as unrelated standalone projects
    assert_eq!(res.candidates.len(), 2);

    let h2o = res
        .candidates
        .iter()
        .find(|c| c.name == "h2o-platform")
        .unwrap();
    assert_eq!(h2o.kind, ScanCandidateKind::Monorepo);
    assert_eq!(h2o.package_manager, PackageManager::Pnpm);
    assert_eq!(h2o.workspace_packages.len(), 2);
    let h2o_pkg_names: Vec<&str> = h2o
        .workspace_packages
        .iter()
        .map(|p| p.name.as_str())
        .collect();
    assert!(h2o_pkg_names.contains(&"@h2o/web"));
    assert!(h2o_pkg_names.contains(&"@h2o/api"));

    let shop = res
        .candidates
        .iter()
        .find(|c| c.name == "shop-suite")
        .unwrap();
    assert_eq!(shop.kind, ScanCandidateKind::Monorepo);
    assert_eq!(shop.package_manager, PackageManager::Yarn);
    assert_eq!(shop.workspace_packages.len(), 1);
    assert_eq!(shop.workspace_packages[0].framework, Framework::Vite);
}

#[test]
fn scanner_marks_already_registered_folders_and_supports_multi_folder_grouping() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    let fe = root.join("lms-frontend");
    let be = root.join("lms-backend");
    let landing = root.join("landing-page");

    write_pkg(
        &fe,
        r#"{ "name": "lms-frontend", "dependencies": { "next": "15.0.0" }, "scripts": { "dev": "next dev" } }"#,
    );
    write_pkg(
        &be,
        r#"{ "name": "lms-backend", "dependencies": { "@nestjs/core": "10.0.0" }, "scripts": { "start:dev": "nest start --watch" } }"#,
    );
    write_pkg(
        &landing,
        r#"{ "name": "landing-page", "devDependencies": { "astro": "5.0.0" }, "scripts": { "dev": "astro dev" } }"#,
    );

    let core = DevDockCore::in_memory_for_tests("/usr/bin").unwrap();

    // Register landing-page first
    core.register_folder_as_project(&landing, None).unwrap();

    // Scan should mark landing-page as already_registered
    let scan = core.scan_folder(root, None).unwrap();
    assert_eq!(scan.candidates.len(), 3);
    assert!(
        scan.candidates
            .iter()
            .find(|c| c.name == "landing-page")
            .unwrap()
            .already_registered
    );
    assert!(
        !scan
            .candidates
            .iter()
            .find(|c| c.name == "lms-frontend")
            .unwrap()
            .already_registered
    );

    // Group lms-frontend + lms-backend into one named Project "LMS App"
    let grouped = core
        .register_grouped_project("LMS App", &[be.clone(), fe.clone()], None)
        .unwrap();
    assert_eq!(grouped.name, "LMS App");
    assert_eq!(grouped.services.len(), 2);
    assert_eq!(grouped.services[0].name, "lms-backend");
    assert_eq!(grouped.services[0].start_order, 0);
    assert_eq!(grouped.services[1].name, "lms-frontend");
    assert_eq!(grouped.services[1].start_order, 1);

    // Re-scan: all 3 should now be marked already_registered
    let scan_after = core.scan_folder(root, None).unwrap();
    assert!(scan_after.candidates.iter().all(|c| c.already_registered));
}
