use crate::db_tester::DbConnectionTester;
use crate::error::{CoreError, CoreResult};
use crate::models::{
    AttachedPreset, EnvFileInfo, EnvPreset, EnvWriteResult, MissingEnvKey, ResolvedEnvEntry,
    Service, ServiceEnvInspection,
};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

const DEFAULT_MODE: &str = "development";

const SECRET_KEY_PATTERNS: &[&str] = &[
    "SECRET",
    "PASSWORD",
    "PASSWD",
    "TOKEN",
    "API_KEY",
    "APIKEY",
    "PRIVATE_KEY",
    "AUTH",
    "CREDENTIAL",
    "DATABASE_URL",
    "REDIS_URL",
    "MONGO",
    "JWT",
    "SIGNING",
    "ENCRYPTION",
    "ACCESS_KEY",
    "CLIENT_SECRET",
];

pub struct EnvResolver;

impl EnvResolver {
    pub fn is_secret_like(key: &str, value: &str) -> bool {
        let upper = key.to_ascii_uppercase();
        if SECRET_KEY_PATTERNS.iter().any(|pat| upper.contains(pat)) {
            return true;
        }
        // Detect URL with embedded credentials like scheme://user:pass@host
        if let Some(after_scheme) = value.split("://").nth(1) {
            if let Some(authority) = after_scheme.split('/').next() {
                if authority.contains('@') && authority.contains(':') {
                    return true;
                }
            }
        }
        false
    }

    pub fn parse_dotenv(content: &str) -> BTreeMap<String, String> {
        let mut map = BTreeMap::new();

        for raw_line in content.lines() {
            let trimmed = raw_line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            let line = trimmed.strip_prefix("export ").unwrap_or(trimmed).trim();
            let Some((raw_key, raw_val)) = line.split_once('=') else {
                continue;
            };

            let key = raw_key.trim();
            if key.is_empty()
                || !key
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
            {
                continue;
            }

            let val_trimmed = raw_val.trim();
            let value = if val_trimmed.starts_with('"') && val_trimmed.ends_with('"') && val_trimmed.len() >= 2 {
                let inner = &val_trimmed[1..val_trimmed.len() - 1];
                inner
                    .replace("\\n", "\n")
                    .replace("\\r", "\r")
                    .replace("\\t", "\t")
                    .replace("\\\"", "\"")
                    .replace("\\\\", "\\")
            } else if val_trimmed.starts_with('\'') && val_trimmed.ends_with('\'') && val_trimmed.len() >= 2 {
                val_trimmed[1..val_trimmed.len() - 1].to_string()
            } else {
                // Strip inline comments preceded by whitespace for unquoted values
                match val_trimmed.find(" #") {
                    Some(idx) => val_trimmed[..idx].trim_end().to_string(),
                    None => val_trimmed.to_string(),
                }
            };

            map.insert(key.to_string(), value);
        }

        map
    }

    pub fn format_dotenv_value(value: &str) -> String {
        let needs_quotes = value.is_empty()
            || value.contains(char::is_whitespace)
            || value.contains('#')
            || value.contains('"')
            || value.contains('\'')
            || value.contains('\n');
        if !needs_quotes {
            return value.to_string();
        }
        let escaped = value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
            .replace('\t', "\\t");
        format!("\"{escaped}\"")
    }

    fn discover_modes(folder: &Path) -> Vec<String> {
        let mut modes = BTreeSet::new();
        modes.insert("development".to_string());
        modes.insert("production".to_string());

        if let Ok(entries) = std::fs::read_dir(folder) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if let Some(rest) = name_str.strip_prefix(".env.") {
                    if rest.ends_with(".bak")
                        || rest == "local"
                        || rest == "example"
                        || rest == "sample"
                        || rest == "template"
                    {
                        continue;
                    }
                    let mode_part = rest.strip_suffix(".local").unwrap_or(rest);
                    if !mode_part.is_empty() && !mode_part.contains('.') {
                        modes.insert(mode_part.to_string());
                    }
                }
            }
        }

        modes.into_iter().collect()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn inspect_service(
        service: &Service,
        mode: Option<&str>,
        shell_env: &HashMap<String, String>,
        project_presets: &[EnvPreset],
        service_presets: &[EnvPreset],
        project_attached: Vec<AttachedPreset>,
        service_attached: Vec<AttachedPreset>,
    ) -> CoreResult<ServiceEnvInspection> {
        let folder = PathBuf::from(&service.path);
        if !folder.is_dir() {
            return Err(CoreError::InvalidFolder(format!(
                "Service folder does not exist: {}",
                folder.display()
            )));
        }

        let active_mode = mode
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_MODE)
            .to_string();

        let available_modes = Self::discover_modes(&folder);

        // Standard dotenv priority order (lowest -> highest)
        let ordered_files = vec![
            ".env".to_string(),
            ".env.local".to_string(),
            format!(".env.{active_mode}"),
            format!(".env.{active_mode}.local"),
        ];

        let mut files_info = Vec::with_capacity(ordered_files.len());
        let mut parsed_files: Vec<(String, BTreeMap<String, String>)> = Vec::new();
        let mut relevant_keys: BTreeSet<String> = BTreeSet::new();

        for file_name in &ordered_files {
            let file_path = folder.join(file_name);
            let exists = file_path.is_file();
            let mut key_count = 0usize;

            if exists {
                if let Ok(content) = std::fs::read_to_string(&file_path) {
                    let parsed = Self::parse_dotenv(&content);
                    key_count = parsed.len();
                    for k in parsed.keys() {
                        relevant_keys.insert(k.clone());
                    }
                    parsed_files.push((file_name.clone(), parsed));
                }
            }

            files_info.push(EnvFileInfo {
                name: file_name.clone(),
                path: file_path.to_string_lossy().to_string(),
                exists,
                key_count,
            });
        }

        // Parse .env.example if present
        let example_path = folder.join(".env.example");
        let has_example_file = example_path.is_file();
        let example_map = if has_example_file {
            std::fs::read_to_string(&example_path)
                .map(|c| Self::parse_dotenv(&c))
                .unwrap_or_default()
        } else {
            BTreeMap::new()
        };
        for k in example_map.keys() {
            relevant_keys.insert(k.clone());
        }
        for preset in project_presets.iter().chain(service_presets.iter()) {
            for entry in &preset.entries {
                relevant_keys.insert(entry.key.clone());
            }
        }
        if service.port.is_some() {
            relevant_keys.insert("PORT".to_string());
        }

        // (value, source, layer_kind, is_secret, overridden_sources)
        let mut resolved_map: BTreeMap<String, (String, String, String, bool, Vec<String>)> =
            BTreeMap::new();

        let apply_entry = |map: &mut BTreeMap<
            String,
            (String, String, String, bool, Vec<String>),
        >,
                           key: String,
                           value: String,
                           source: String,
                           layer_kind: &str,
                           explicit_secret: bool| {
            let is_secret = explicit_secret || Self::is_secret_like(&key, &value);
            if let Some((prev_val, prev_src, prev_kind, prev_secret, prev_overrides)) =
                map.get_mut(&key)
            {
                prev_overrides.push(prev_src.clone());
                *prev_val = value;
                *prev_src = source;
                *prev_kind = layer_kind.to_string();
                *prev_secret = is_secret;
            } else {
                map.insert(
                    key,
                    (
                        value,
                        source,
                        layer_kind.to_string(),
                        is_secret,
                        Vec::new(),
                    ),
                );
            }
        };

        // Layer 1: shell env (only keys relevant to this service's env files, presets, example, or PORT)
        for key in &relevant_keys {
            if let Some(val) = shell_env.get(key) {
                apply_entry(
                    &mut resolved_map,
                    key.clone(),
                    val.clone(),
                    "shell".to_string(),
                    "shell",
                    false,
                );
            }
        }

        // Layer 2: service .env* files
        for (file_name, parsed) in parsed_files {
            for (k, v) in parsed {
                apply_entry(
                    &mut resolved_map,
                    k,
                    v,
                    file_name.clone(),
                    "file",
                    false,
                );
            }
        }

        // Layer 3: project presets (ordered)
        for preset in project_presets {
            let source = format!("project:{}", preset.name);
            for entry in &preset.entries {
                apply_entry(
                    &mut resolved_map,
                    entry.key.clone(),
                    entry.value.clone(),
                    source.clone(),
                    "project_preset",
                    entry.is_secret,
                );
            }
        }

        // Layer 4: service presets (ordered)
        for preset in service_presets {
            let source = format!("service:{}", preset.name);
            for entry in &preset.entries {
                apply_entry(
                    &mut resolved_map,
                    entry.key.clone(),
                    entry.value.clone(),
                    source.clone(),
                    "service_preset",
                    entry.is_secret,
                );
            }
        }

        // Layer 5: DevDock-assigned PORT
        if let Some(port) = service.port {
            apply_entry(
                &mut resolved_map,
                "PORT".to_string(),
                port.to_string(),
                "DevDock PORT".to_string(),
                "port",
                false,
            );
        }

        let entries: Vec<ResolvedEnvEntry> = resolved_map
            .iter()
            .map(
                |(key, (value, source, layer_kind, is_secret, overridden_sources))| {
                    let is_unknown = has_example_file && !example_map.contains_key(key);
                    ResolvedEnvEntry {
                        key: key.clone(),
                        value: value.clone(),
                        source: source.clone(),
                        layer_kind: layer_kind.clone(),
                        is_secret: *is_secret,
                        is_unknown,
                        detected_db_kind: DbConnectionTester::detect_db_kind(key, value),
                        overridden_sources: overridden_sources.clone(),
                    }
                },
            )
            .collect();

        let missing_keys: Vec<MissingEnvKey> = if has_example_file {
            example_map
                .iter()
                .filter(|(k, _)| !resolved_map.contains_key(*k))
                .map(|(k, example_val)| MissingEnvKey {
                    key: k.clone(),
                    example_value: example_val.clone(),
                    is_secret: Self::is_secret_like(k, example_val),
                })
                .collect()
        } else {
            Vec::new()
        };

        Ok(ServiceEnvInspection {
            service_id: service.id.clone(),
            mode: active_mode,
            available_modes,
            files: files_info,
            project_presets: project_attached,
            service_presets: service_attached,
            assigned_port: service.port,
            has_example_file,
            entries,
            missing_keys,
        })
    }

    /// Resolves the full process spawn environment in exact precedence order:
    /// `shell -> service .env* -> project presets -> service presets -> DevDock PORT`.
    pub fn resolve_runtime_env(
        service: &Service,
        mode: Option<&str>,
        shell_env: &HashMap<String, String>,
        project_presets: &[EnvPreset],
        service_presets: &[EnvPreset],
    ) -> CoreResult<BTreeMap<String, String>> {
        let mut env: BTreeMap<String, String> = shell_env
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        let folder = PathBuf::from(&service.path);
        let active_mode = mode
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_MODE);

        let ordered_files = [
            ".env".to_string(),
            ".env.local".to_string(),
            format!(".env.{active_mode}"),
            format!(".env.{active_mode}.local"),
        ];

        if folder.is_dir() {
            for file_name in &ordered_files {
                let file_path = folder.join(file_name);
                if file_path.is_file() {
                    if let Ok(content) = std::fs::read_to_string(&file_path) {
                        for (k, v) in Self::parse_dotenv(&content) {
                            env.insert(k, v);
                        }
                    }
                }
            }
        }

        for preset in project_presets {
            for entry in &preset.entries {
                env.insert(entry.key.clone(), entry.value.clone());
            }
        }

        for preset in service_presets {
            for entry in &preset.entries {
                env.insert(entry.key.clone(), entry.value.clone());
            }
        }

        if let Some(port) = service.port {
            env.insert("PORT".to_string(), port.to_string());
        }

        Ok(env)
    }

    fn validate_target_env_file(target_file: &str) -> CoreResult<String> {
        let trimmed = target_file.trim();
        if trimmed.is_empty()
            || !trimmed.starts_with(".env")
            || trimmed.contains('/')
            || trimmed.contains('\\')
            || trimmed.contains("..")
            || trimmed == ".env.example"
            || trimmed.ends_with(".bak")
        {
            return Err(CoreError::Validation(format!(
                "Invalid target env filename: {target_file}"
            )));
        }
        Ok(trimmed.to_string())
    }

    fn backup_if_exists(target_path: &Path, target_file: &str) -> CoreResult<Option<String>> {
        if target_path.is_file() {
            let backup_name = format!("{target_file}.bak");
            let backup_path = target_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join(backup_name);
            std::fs::copy(target_path, &backup_path)?;
            Ok(Some(backup_path.to_string_lossy().to_string()))
        } else {
            Ok(None)
        }
    }

    pub fn write_env_file(
        service: &Service,
        target_file: &str,
        entries: &BTreeMap<String, String>,
    ) -> CoreResult<EnvWriteResult> {
        let folder = PathBuf::from(&service.path);
        if !folder.is_dir() {
            return Err(CoreError::InvalidFolder(format!(
                "Service folder does not exist: {}",
                folder.display()
            )));
        }

        let safe_name = Self::validate_target_env_file(target_file)?;
        let target_path = folder.join(&safe_name);
        let backup_path = Self::backup_if_exists(&target_path, &safe_name)?;

        let mut lines = Vec::with_capacity(entries.len());
        for (key, value) in entries {
            let k = key.trim();
            if k.is_empty() {
                continue;
            }
            lines.push(format!("{k}={}", Self::format_dotenv_value(value)));
        }

        let content = if lines.is_empty() {
            String::new()
        } else {
            format!("{}\n", lines.join("\n"))
        };
        std::fs::write(&target_path, content)?;

        Ok(EnvWriteResult {
            target_file: safe_name,
            target_path: target_path.to_string_lossy().to_string(),
            backup_path,
            written_keys: lines.len(),
        })
    }

    pub fn update_env_key(
        service: &Service,
        target_file: &str,
        key: &str,
        value: &str,
    ) -> CoreResult<EnvWriteResult> {
        let trimmed_key = key.trim();
        if trimmed_key.is_empty()
            || !trimmed_key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
        {
            return Err(CoreError::Validation(format!(
                "Invalid env key name: {key}"
            )));
        }

        let folder = PathBuf::from(&service.path);
        if !folder.is_dir() {
            return Err(CoreError::InvalidFolder(format!(
                "Service folder does not exist: {}",
                folder.display()
            )));
        }

        let safe_name = Self::validate_target_env_file(target_file)?;
        let target_path = folder.join(&safe_name);
        let backup_path = Self::backup_if_exists(&target_path, &safe_name)?;

        let formatted_line = format!("{trimmed_key}={}", Self::format_dotenv_value(value));
        let mut out_lines: Vec<String> = Vec::new();
        let mut replaced = false;

        if target_path.is_file() {
            let existing = std::fs::read_to_string(&target_path)?;
            for raw_line in existing.lines() {
                let trimmed = raw_line.trim();
                let candidate = trimmed.strip_prefix("export ").unwrap_or(trimmed).trim();
                if let Some((k, _)) = candidate.split_once('=') {
                    if k.trim() == trimmed_key {
                        out_lines.push(formatted_line.clone());
                        replaced = true;
                        continue;
                    }
                }
                out_lines.push(raw_line.to_string());
            }
        }

        if !replaced {
            out_lines.push(formatted_line);
        }

        let content = format!("{}\n", out_lines.join("\n"));
        std::fs::write(&target_path, &content)?;

        let written_keys = Self::parse_dotenv(&content).len();

        Ok(EnvWriteResult {
            target_file: safe_name,
            target_path: target_path.to_string_lossy().to_string(),
            backup_path,
            written_keys,
        })
    }
}
