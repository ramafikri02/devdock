use crate::db::Database;
use crate::error::{CoreError, CoreResult};
use crate::models::{
    ExportSummary, FolderRelocationCheck, ImportPreview, ImportResult, ImportServiceResolution,
    PackageManager, PortInjectionMethod, Project,
};
use crate::presets::PresetStore;
use crate::traits::SecretStore;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Utc;
use hmac::Hmac;
use pbkdf2::pbkdf2;
use rand::RngCore;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

pub const EXPORT_FORMAT_VERSION: u32 = 1;
const PBKDF2_ITERATIONS: u32 = 100_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedSecretsBlob {
    kdf: String,
    iterations: u32,
    salt_b64: String,
    nonce_b64: String,
    ciphertext_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedPresetEntry {
    key: String,
    is_secret: bool,
    value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedPreset {
    name: String,
    entries: Vec<ExportedPresetEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedService {
    name: String,
    path: String,
    adapter: String,
    package_name: Option<String>,
    start_order: i32,
    default_script: Option<String>,
    pm_override: Option<PackageManager>,
    port: Option<u16>,
    port_injection: Option<PortInjectionMethod>,
    node_version_override: Option<String>,
    auto_restart_scripts: Vec<String>,
    presets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedProject {
    name: String,
    root_path: Option<String>,
    presets: Vec<String>,
    services: Vec<ExportedService>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportBundle {
    format_version: u32,
    exported_at: String,
    source_os: String,
    includes_secrets: bool,
    settings: BTreeMap<String, String>,
    presets: Vec<ExportedPreset>,
    encrypted_secrets: Option<EncryptedSecretsBlob>,
    projects: Vec<ExportedProject>,
}

type DecryptedSecretsMap = BTreeMap<String, BTreeMap<String, String>>;

pub struct ExportImportManager<'a> {
    db: &'a Database,
    secrets: &'a Arc<dyn SecretStore>,
}

impl<'a> ExportImportManager<'a> {
    pub fn new(db: &'a Database, secrets: &'a Arc<dyn SecretStore>) -> Self {
        Self { db, secrets }
    }

    pub fn export_bundle(
        &self,
        projects: &[Project],
        include_secrets: bool,
        passphrase: Option<&str>,
    ) -> CoreResult<(String, usize, usize)> {
        let store = PresetStore::new(self.db, self.secrets);
        let all_presets = store.list_presets()?;

        let mut exported_presets = Vec::with_capacity(all_presets.len());
        let mut secrets_map: DecryptedSecretsMap = BTreeMap::new();
        let mut secret_count = 0usize;

        for preset in &all_presets {
            let mut entries = Vec::with_capacity(preset.entries.len());
            for entry in &preset.entries {
                if entry.is_secret {
                    if include_secrets {
                        secret_count += 1;
                        secrets_map
                            .entry(preset.name.clone())
                            .or_default()
                            .insert(entry.key.clone(), entry.value.clone());
                    }
                    entries.push(ExportedPresetEntry {
                        key: entry.key.clone(),
                        is_secret: true,
                        value: None,
                    });
                } else {
                    entries.push(ExportedPresetEntry {
                        key: entry.key.clone(),
                        is_secret: false,
                        value: Some(entry.value.clone()),
                    });
                }
            }
            exported_presets.push(ExportedPreset {
                name: preset.name.clone(),
                entries,
            });
        }

        let encrypted_secrets = if include_secrets {
            let pass = passphrase
                .map(str::trim)
                .filter(|p| !p.is_empty())
                .ok_or_else(|| {
                    CoreError::Validation(
                        "Passphrase is required when including secrets".to_string(),
                    )
                })?;
            Some(encrypt_secrets_map(&secrets_map, pass)?)
        } else {
            None
        };

        let settings: BTreeMap<String, String> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT key, value FROM setting ORDER BY key ASC")?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows.into_iter().collect())
        })?;

        let mut exported_projects = Vec::with_capacity(projects.len());
        let mut service_count = 0usize;
        for proj in projects {
            let proj_presets = store
                .list_project_presets(&proj.id)?
                .into_iter()
                .map(|p| p.preset_name)
                .collect();

            let mut exported_services = Vec::with_capacity(proj.services.len());
            for svc in &proj.services {
                service_count += 1;
                let svc_presets = store
                    .list_service_presets(&svc.id)?
                    .into_iter()
                    .map(|p| p.preset_name)
                    .collect();
                let package_name = read_package_json_name(Path::new(&svc.path));
                exported_services.push(ExportedService {
                    name: svc.name.clone(),
                    path: svc.path.clone(),
                    adapter: svc.adapter.clone(),
                    package_name,
                    start_order: svc.start_order,
                    default_script: svc.default_script.clone(),
                    pm_override: svc.pm_override.clone(),
                    port: svc.port,
                    port_injection: svc.port_injection.clone(),
                    node_version_override: svc.node_version_override.clone(),
                    auto_restart_scripts: svc.auto_restart_scripts.clone(),
                    presets: svc_presets,
                });
            }

            exported_projects.push(ExportedProject {
                name: proj.name.clone(),
                root_path: proj.root_path.clone(),
                presets: proj_presets,
                services: exported_services,
            });
        }

        let bundle = ExportBundle {
            format_version: EXPORT_FORMAT_VERSION,
            exported_at: Utc::now().to_rfc3339(),
            source_os: std::env::consts::OS.to_string(),
            includes_secrets: include_secrets,
            settings,
            presets: exported_presets,
            encrypted_secrets,
            projects: exported_projects,
        };

        let json = serde_json::to_string_pretty(&bundle)
            .map_err(|e| CoreError::Adapter(format!("Failed to serialize export bundle: {e}")))?;

        Ok((json, service_count, secret_count))
    }

    pub fn export_to_file(
        &self,
        projects: &[Project],
        output_path: &Path,
        include_secrets: bool,
        passphrase: Option<&str>,
    ) -> CoreResult<ExportSummary> {
        let (json, service_count, secret_count) =
            self.export_bundle(projects, include_secrets, passphrase)?;

        if let Some(parent) = output_path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        std::fs::write(output_path, json)?;

        let preset_count = PresetStore::new(self.db, self.secrets)
            .list_presets()?
            .len();

        Ok(ExportSummary {
            format_version: EXPORT_FORMAT_VERSION,
            project_count: projects.len(),
            service_count,
            preset_count,
            secret_count,
            includes_secrets: include_secrets,
            output_path: output_path.to_string_lossy().to_string(),
        })
    }

    pub fn preview_import(
        &self,
        raw_json: &str,
        passphrase: Option<&str>,
        parent_remap: Option<(&str, &str)>,
        path_overrides: &HashMap<String, String>,
    ) -> CoreResult<ImportPreview> {
        let bundle = parse_and_validate_bundle(raw_json)?;
        let (passphrase_verified, decrypted) = decrypt_bundle_secrets(&bundle, passphrase, false)?;

        let all_original_paths: Vec<String> = bundle
            .projects
            .iter()
            .flat_map(|p| p.services.iter().map(|s| s.path.clone()))
            .collect();
        let suggested_common_parent = detect_common_parent(&all_original_paths);

        let mut services = Vec::new();
        let mut missing_count = 0usize;

        for (p_idx, proj) in bundle.projects.iter().enumerate() {
            for (s_idx, svc) in proj.services.iter().enumerate() {
                let service_key = make_service_key(p_idx, s_idx, &svc.name);
                let resolved_path = resolve_service_path(
                    &svc.path,
                    &service_key,
                    parent_remap,
                    path_overrides,
                );
                let check = validate_relocated_folder(
                    Path::new(&resolved_path),
                    svc.package_name.as_deref(),
                );
                if !check.exists {
                    missing_count += 1;
                }
                services.push(ImportServiceResolution {
                    project_name: proj.name.clone(),
                    service_key,
                    service_name: svc.name.clone(),
                    expected_package_name: svc.package_name.clone(),
                    original_path: svc.path.clone(),
                    resolved_path,
                    exists_on_disk: check.exists,
                    package_name_matches: check.matches_package_name,
                    detected_package_name: check.package_name,
                    warning: check.warning,
                });
            }
        }

        let secret_count = if let Some(ref map) = decrypted {
            map.values().map(|m| m.len()).sum()
        } else {
            bundle
                .presets
                .iter()
                .flat_map(|p| p.entries.iter())
                .filter(|e| e.is_secret)
                .count()
        };

        Ok(ImportPreview {
            format_version: bundle.format_version,
            exported_at: bundle.exported_at,
            source_os: bundle.source_os,
            includes_secrets: bundle.includes_secrets,
            passphrase_verified,
            project_count: bundle.projects.len(),
            service_count: services.len(),
            preset_count: bundle.presets.len(),
            secret_count,
            suggested_common_parent,
            missing_count,
            services,
        })
    }

    pub fn apply_import(
        &self,
        raw_json: &str,
        passphrase: Option<&str>,
        parent_remap: Option<(&str, &str)>,
        path_overrides: &HashMap<String, String>,
    ) -> CoreResult<ImportResult> {
        let bundle = parse_and_validate_bundle(raw_json)?;
        let (_verified, decrypted) = decrypt_bundle_secrets(&bundle, passphrase, true)?;
        let secrets_map = decrypted.unwrap_or_default();

        // 1. Restore settings
        self.db.with_conn(|conn| {
            for (k, v) in &bundle.settings {
                conn.execute(
                    "INSERT INTO setting (key, value) VALUES (?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![k, v],
                )?;
            }
            Ok(())
        })?;

        // 2. Restore presets & store secrets in destination SecretStore
        let mut preset_id_by_name: HashMap<String, String> = HashMap::new();
        let mut presets_imported = 0usize;
        let mut secrets_stored = 0usize;
        let now = Utc::now().to_rfc3339();

        for preset in &bundle.presets {
            let preset_id: String = self.db.with_conn(|conn| {
                let existing_id: Option<String> = conn
                    .query_row(
                        "SELECT id FROM preset WHERE name = ?1",
                        params![preset.name],
                        |r| r.get(0),
                    )
                    .optional()?;

                let id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
                conn.execute(
                    "INSERT INTO preset (id, name, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at",
                    params![id, preset.name, now, now],
                )?;

                conn.execute("DELETE FROM preset_entry WHERE preset_id = ?1", params![id])?;

                for entry in &preset.entries {
                    let entry_id = Uuid::new_v4().to_string();
                    let non_secret_val = if entry.is_secret {
                        None
                    } else {
                        Some(entry.value.clone().unwrap_or_default())
                    };
                    conn.execute(
                        "INSERT INTO preset_entry (id, preset_id, key, is_secret, value)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![
                            entry_id,
                            id,
                            entry.key,
                            if entry.is_secret { 1 } else { 0 },
                            non_secret_val
                        ],
                    )?;
                }
                Ok(id)
            })?;

            if let Some(preset_secrets) = secrets_map.get(&preset.name) {
                for (key, secret_val) in preset_secrets {
                    let store_key = PresetStore::secret_store_key(&preset_id, key);
                    self.secrets.set(&store_key, secret_val)?;
                    secrets_stored += 1;
                }
            }

            preset_id_by_name.insert(preset.name.clone(), preset_id);
            presets_imported += 1;
        }

        // 3. Restore projects, services, script settings, and preset attachments
        let mut projects_imported = 0usize;
        let mut services_imported = 0usize;
        let mut missing_services = 0usize;

        for (p_idx, proj) in bundle.projects.iter().enumerate() {
            let remapped_root = proj
                .root_path
                .as_deref()
                .map(|rp| match parent_remap {
                    Some((old_p, new_p)) => remap_path_prefix(rp, old_p, new_p),
                    None => rp.to_string(),
                });

            let project_id = Uuid::new_v4().to_string();
            self.db.with_conn(|conn| {
                conn.execute(
                    "INSERT INTO project (id, name, root_path, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![project_id, proj.name, remapped_root, now, now],
                )?;
                for (pos, preset_name) in proj.presets.iter().enumerate() {
                    if let Some(pid) = preset_id_by_name.get(preset_name) {
                        conn.execute(
                            "INSERT OR IGNORE INTO project_preset (project_id, preset_id, position)
                             VALUES (?1, ?2, ?3)",
                            params![project_id, pid, pos as i32],
                        )?;
                    }
                }
                Ok(())
            })?;
            projects_imported += 1;

            for (s_idx, svc) in proj.services.iter().enumerate() {
                let service_key = make_service_key(p_idx, s_idx, &svc.name);
                let resolved_path = resolve_service_path(
                    &svc.path,
                    &service_key,
                    parent_remap,
                    path_overrides,
                );
                let canonical = if Path::new(&resolved_path).is_dir() {
                    std::fs::canonicalize(&resolved_path)
                        .unwrap_or_else(|_| PathBuf::from(&resolved_path))
                        .to_string_lossy()
                        .to_string()
                } else {
                    missing_services += 1;
                    resolved_path.clone()
                };

                let service_id = Uuid::new_v4().to_string();
                let pm_override_str = svc.pm_override.as_ref().map(PackageManager::as_str);
                let port_i64 = svc.port.map(|p| p as i64);
                let port_inj_str = svc.port_injection.as_ref().map(|m| match m {
                    PortInjectionMethod::Env => "env",
                    PortInjectionMethod::Flag => "flag",
                    PortInjectionMethod::Both => "both",
                });

                self.db.with_conn(|conn| {
                    // Remove any prior registration for the same path so import is clean
                    conn.execute("DELETE FROM service WHERE path = ?1", params![canonical])?;
                    conn.execute(
                        "INSERT INTO service (
                            id, project_id, name, path, adapter, start_order, default_script,
                            pm_override, port, port_injection, node_version_override,
                            created_at, updated_at
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                        params![
                            service_id,
                            project_id,
                            svc.name,
                            canonical,
                            svc.adapter,
                            svc.start_order,
                            svc.default_script,
                            pm_override_str,
                            port_i64,
                            port_inj_str,
                            svc.node_version_override,
                            now,
                            now
                        ],
                    )?;

                    for script_name in &svc.auto_restart_scripts {
                        conn.execute(
                            "INSERT OR REPLACE INTO script_setting (service_id, script_name, auto_restart)
                             VALUES (?1, ?2, 1)",
                            params![service_id, script_name],
                        )?;
                    }

                    for (pos, preset_name) in svc.presets.iter().enumerate() {
                        if let Some(pid) = preset_id_by_name.get(preset_name) {
                            conn.execute(
                                "INSERT OR IGNORE INTO service_preset (service_id, preset_id, position)
                                 VALUES (?1, ?2, ?3)",
                                params![service_id, pid, pos as i32],
                            )?;
                        }
                    }
                    Ok(())
                })?;
                services_imported += 1;
            }
        }

        Ok(ImportResult {
            projects_imported,
            services_imported,
            presets_imported,
            secrets_stored,
            missing_services,
        })
    }
}

fn make_service_key(proj_idx: usize, svc_idx: usize, svc_name: &str) -> String {
    format!("{proj_idx}:{svc_idx}:{svc_name}")
}

fn resolve_service_path(
    original_path: &str,
    service_key: &str,
    parent_remap: Option<(&str, &str)>,
    path_overrides: &HashMap<String, String>,
) -> String {
    if let Some(override_path) = path_overrides.get(service_key) {
        let trimmed = override_path.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Some((old_prefix, new_prefix)) = parent_remap {
        return remap_path_prefix(original_path, old_prefix, new_prefix);
    }
    original_path.to_string()
}

fn parse_and_validate_bundle(raw_json: &str) -> CoreResult<ExportBundle> {
    let bundle: ExportBundle = serde_json::from_str(raw_json)
        .map_err(|e| CoreError::Validation(format!("Invalid export file: {e}")))?;

    if bundle.format_version == 0 || bundle.format_version > EXPORT_FORMAT_VERSION {
        return Err(CoreError::Validation(format!(
            "Unsupported export format version v{} (supported: v{EXPORT_FORMAT_VERSION})",
            bundle.format_version
        )));
    }

    Ok(bundle)
}

fn decrypt_bundle_secrets(
    bundle: &ExportBundle,
    passphrase: Option<&str>,
    require_when_present: bool,
) -> CoreResult<(bool, Option<DecryptedSecretsMap>)> {
    if !bundle.includes_secrets {
        return Ok((true, None));
    }
    let Some(blob) = &bundle.encrypted_secrets else {
        return Ok((true, None));
    };

    let trimmed = passphrase.map(str::trim).filter(|p| !p.is_empty());
    let Some(pass) = trimmed else {
        if require_when_present {
            return Err(CoreError::Validation(
                "This file contains encrypted secrets; enter the passphrase to import.".to_string(),
            ));
        }
        return Ok((false, None));
    };

    match decrypt_secrets_map(blob, pass) {
        Ok(map) => Ok((true, Some(map))),
        Err(err) => {
            if require_when_present {
                Err(err)
            } else {
                Ok((false, None))
            }
        }
    }
}

fn derive_aes_key(passphrase: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::<Hmac<Sha256>>(passphrase.as_bytes(), salt, iterations, &mut key)
        .expect("HMAC-SHA256 PBKDF2 key length is valid");
    key
}

fn encrypt_secrets_map(
    secrets: &DecryptedSecretsMap,
    passphrase: &str,
) -> CoreResult<EncryptedSecretsBlob> {
    let plaintext = serde_json::to_vec(secrets)
        .map_err(|e| CoreError::Adapter(format!("Failed to serialize secrets: {e}")))?;

    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let key = derive_aes_key(passphrase, &salt, PBKDF2_ITERATIONS);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| CoreError::Adapter(format!("Cipher init error: {e}")))?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_ref())
        .map_err(|e| CoreError::Adapter(format!("Encryption failed: {e}")))?;

    Ok(EncryptedSecretsBlob {
        kdf: "pbkdf2-hmac-sha256".to_string(),
        iterations: PBKDF2_ITERATIONS,
        salt_b64: BASE64.encode(salt),
        nonce_b64: BASE64.encode(nonce_bytes),
        ciphertext_b64: BASE64.encode(ciphertext),
    })
}

fn decrypt_secrets_map(
    blob: &EncryptedSecretsBlob,
    passphrase: &str,
) -> CoreResult<DecryptedSecretsMap> {
    let salt = BASE64
        .decode(&blob.salt_b64)
        .map_err(|_| CoreError::Validation("Corrupted export salt data".to_string()))?;
    let nonce_bytes = BASE64
        .decode(&blob.nonce_b64)
        .map_err(|_| CoreError::Validation("Corrupted export nonce data".to_string()))?;
    let ciphertext = BASE64
        .decode(&blob.ciphertext_b64)
        .map_err(|_| CoreError::Validation("Corrupted export ciphertext data".to_string()))?;

    if nonce_bytes.len() != 12 {
        return Err(CoreError::Validation("Invalid nonce length".to_string()));
    }

    let key = derive_aes_key(passphrase, &salt, blob.iterations.max(1));
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| CoreError::Adapter(format!("Cipher init error: {e}")))?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| {
            CoreError::Validation("Incorrect passphrase or corrupted secret data".to_string())
        })?;

    serde_json::from_slice(&plaintext)
        .map_err(|e| CoreError::Validation(format!("Invalid decrypted secret format: {e}")))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SplitPath {
    root: Option<String>,
    segments: Vec<String>,
    is_windows_style: bool,
}

fn split_cross_os_path(raw: &str) -> SplitPath {
    let trimmed = raw.trim();
    let has_backslash = trimmed.contains('\\');
    let normalized = trimmed.replace('\\', "/");

    // Detect Windows drive root (e.g. `D:/code/H2o`) or UNC (`//server/share`)
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        let drive = format!("{}:", (bytes[0] as char).to_ascii_uppercase());
        let rest = normalized[2..].trim_start_matches('/');
        let segments = rest
            .split('/')
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .collect();
        return SplitPath {
            root: Some(drive),
            segments,
            is_windows_style: true,
        };
    }

    let is_posix_abs = normalized.starts_with('/');
    let segments = normalized
        .split('/')
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .collect();

    SplitPath {
        root: if is_posix_abs {
            Some("/".to_string())
        } else {
            None
        },
        segments,
        is_windows_style: has_backslash,
    }
}

fn join_cross_os_path(root: Option<&str>, segments: &[String], windows_style: bool) -> String {
    let sep = if windows_style { "\\" } else { "/" };
    let joined = segments.join(sep);
    match root {
        Some("/") => {
            if joined.is_empty() {
                "/".to_string()
            } else {
                format!("/{joined}")
            }
        }
        Some(drive) => {
            if joined.is_empty() {
                format!("{drive}{sep}")
            } else {
                format!("{drive}{sep}{joined}")
            }
        }
        None => joined,
    }
}

/// Detects the deepest common parent directory shared by all provided paths (cross-OS aware).
pub fn detect_common_parent(paths: &[String]) -> Option<String> {
    if paths.is_empty() {
        return None;
    }
    let parsed: Vec<SplitPath> = paths.iter().map(|p| split_cross_os_path(p)).collect();
    if parsed.len() == 1 {
        let first = &parsed[0];
        if first.segments.len() <= 1 {
            return first.root.clone();
        }
        let parent_segs = &first.segments[..first.segments.len() - 1];
        return Some(join_cross_os_path(
            first.root.as_deref(),
            parent_segs,
            first.is_windows_style,
        ));
    }

    let first = &parsed[0];
    if parsed.iter().any(|p| p.root != first.root) {
        return None;
    }

    let min_len = parsed
        .iter()
        .map(|p| p.segments.len().saturating_sub(1))
        .min()
        .unwrap_or(0);
    let mut common_len = 0usize;
    for idx in 0..min_len {
        let seg = &first.segments[idx];
        let all_match = parsed.iter().all(|p| {
            if first.is_windows_style {
                p.segments[idx].eq_ignore_ascii_case(seg)
            } else {
                p.segments[idx] == *seg
            }
        });
        if all_match {
            common_len += 1;
        } else {
            break;
        }
    }

    if common_len == 0 {
        return None;
    }

    Some(join_cross_os_path(
        first.root.as_deref(),
        &first.segments[..common_len],
        first.is_windows_style,
    ))
}

/// Remaps `original` from `old_prefix` to `new_prefix`, translating `/` ↔ `\` cleanly.
pub fn remap_path_prefix(original: &str, old_prefix: &str, new_prefix: &str) -> String {
    let orig = split_cross_os_path(original);
    let old = split_cross_os_path(old_prefix);
    let new = split_cross_os_path(new_prefix);

    if old.segments.is_empty() && old.root.is_none() {
        return original.to_string();
    }
    if orig.root != old.root || orig.segments.len() < old.segments.len() {
        return original.to_string();
    }

    let case_insensitive = orig.is_windows_style || old.is_windows_style;
    let prefix_matches = old
        .segments
        .iter()
        .zip(orig.segments.iter())
        .all(|(a, b)| {
            if case_insensitive {
                a.eq_ignore_ascii_case(b)
            } else {
                a == b
            }
        });

    if !prefix_matches {
        return original.to_string();
    }

    let mut result_segments = new.segments.clone();
    result_segments.extend_from_slice(&orig.segments[old.segments.len()..]);

    let target_windows = if new_prefix.contains('\\')
        || new
            .root
            .as_deref()
            .map(|r| r.ends_with(':'))
            .unwrap_or(false)
    {
        true
    } else if new_prefix.contains('/') {
        false
    } else {
        cfg!(windows)
    };

    join_cross_os_path(new.root.as_deref(), &result_segments, target_windows)
}

pub fn read_package_json_name(folder: &Path) -> Option<String> {
    let pkg_path = folder.join("package.json");
    let raw = std::fs::read_to_string(pkg_path).ok()?;
    let val: serde_json::Value = serde_json::from_str(&raw).ok()?;
    val.get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

pub fn validate_relocated_folder(
    folder: &Path,
    expected_package_name: Option<&str>,
) -> FolderRelocationCheck {
    let path_str = folder.to_string_lossy().to_string();
    if !folder.is_dir() {
        return FolderRelocationCheck {
            path: path_str,
            exists: false,
            package_name: None,
            expected_package_name: expected_package_name.map(ToString::to_string),
            matches_package_name: false,
            warning: Some("Folder not found on disk".to_string()),
        };
    }

    let found_name = read_package_json_name(folder);
    let (matches, warning) = match (expected_package_name, found_name.as_deref()) {
        (Some(expected), Some(actual)) if expected == actual => (true, None),
        (Some(expected), Some(actual)) => (
            false,
            Some(format!(
                "package.json name mismatch: expected '{expected}', found '{actual}'"
            )),
        ),
        (Some(expected), None) => (
            false,
            Some(format!(
                "package.json not found or missing 'name' field (expected '{expected}')"
            )),
        ),
        (None, _) => (true, None),
    };

    FolderRelocationCheck {
        path: path_str,
        exists: true,
        package_name: found_name,
        expected_package_name: expected_package_name.map(ToString::to_string),
        matches_package_name: matches,
        warning,
    }
}
