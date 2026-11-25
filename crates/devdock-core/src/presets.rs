use crate::db::Database;
use crate::env_resolver::EnvResolver;
use crate::error::{CoreError, CoreResult};
use crate::models::{
    AttachedPreset, EnvPreset, PresetEntry, PresetEntryInput, PresetUsage, ProjectEnvSummary,
    ProjectPresetEnvEntry,
};
use crate::traits::SecretStore;
use rusqlite::{params, OptionalExtension};
use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

pub struct PresetStore<'a> {
    db: &'a Database,
    secrets: &'a Arc<dyn SecretStore>,
}

impl<'a> PresetStore<'a> {
    pub fn new(db: &'a Database, secrets: &'a Arc<dyn SecretStore>) -> Self {
        Self { db, secrets }
    }

    pub fn secret_store_key(preset_id: &str, key: &str) -> String {
        format!("preset:{preset_id}:{key}")
    }

    fn validate_preset_name(name: &str) -> CoreResult<String> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(CoreError::Validation(
                "Preset name cannot be empty".to_string(),
            ));
        }
        Ok(trimmed.to_string())
    }

    fn validate_entries(entries: &[PresetEntryInput]) -> CoreResult<Vec<PresetEntryInput>> {
        let mut seen = HashSet::new();
        let mut cleaned = Vec::with_capacity(entries.len());
        for entry in entries {
            let key = entry.key.trim();
            if key.is_empty()
                || !key
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
            {
                return Err(CoreError::Validation(format!(
                    "Invalid env key name in preset: {}",
                    entry.key
                )));
            }
            if !seen.insert(key.to_string()) {
                return Err(CoreError::Validation(format!(
                    "Duplicate key '{}' in preset",
                    key
                )));
            }
            cleaned.push(PresetEntryInput {
                key: key.to_string(),
                value: entry.value.clone(),
                is_secret: entry.is_secret,
            });
        }
        Ok(cleaned)
    }

    pub fn list_presets(&self) -> CoreResult<Vec<EnvPreset>> {
        let ids: Vec<String> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT id FROM preset ORDER BY name ASC")?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })?;

        let mut presets = Vec::with_capacity(ids.len());
        for id in ids {
            presets.push(self.get_preset(&id)?);
        }
        Ok(presets)
    }

    pub fn get_preset(&self, preset_id: &str) -> CoreResult<EnvPreset> {
        let (id, name, created_at, updated_at, raw_entries, usages) = self.db.with_conn(|conn| {
            let row = conn
                .query_row(
                    "SELECT id, name, created_at, updated_at FROM preset WHERE id = ?1",
                    params![preset_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )
                .optional()?
                .ok_or_else(|| CoreError::NotFound(format!("Preset not found: {preset_id}")))?;

            let mut entry_stmt = conn.prepare(
                "SELECT id, key, is_secret, value FROM preset_entry
                 WHERE preset_id = ?1 ORDER BY key ASC",
            )?;
            let raw_entries = entry_stmt
                .query_map(params![preset_id], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)? != 0,
                        r.get::<_, Option<String>>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;

            let mut usages = Vec::new();
            let mut proj_stmt = conn.prepare(
                "SELECT p.id, p.name FROM project_preset pp
                 JOIN project p ON p.id = pp.project_id
                 WHERE pp.preset_id = ?1 ORDER BY p.name ASC",
            )?;
            for item in proj_stmt.query_map(params![preset_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })? {
                let (pid, pname) = item?;
                usages.push(PresetUsage {
                    kind: "project".to_string(),
                    id: pid.clone(),
                    name: pname.clone(),
                    project_id: pid,
                    project_name: pname,
                });
            }

            let mut svc_stmt = conn.prepare(
                "SELECT s.id, s.name, p.id, p.name FROM service_preset sp
                 JOIN service s ON s.id = sp.service_id
                 JOIN project p ON p.id = s.project_id
                 WHERE sp.preset_id = ?1 ORDER BY p.name ASC, s.name ASC",
            )?;
            for item in svc_stmt.query_map(params![preset_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })? {
                let (sid, sname, pid, pname) = item?;
                usages.push(PresetUsage {
                    kind: "service".to_string(),
                    id: sid,
                    name: sname,
                    project_id: pid,
                    project_name: pname,
                });
            }

            Ok((row.0, row.1, row.2, row.3, raw_entries, usages))
        })?;

        let mut entries = Vec::with_capacity(raw_entries.len());
        for (entry_id, key, is_secret, db_val) in raw_entries {
            let value = if is_secret {
                let secret_key = Self::secret_store_key(&id, &key);
                self.secrets.get(&secret_key)?.unwrap_or_default()
            } else {
                db_val.unwrap_or_default()
            };
            entries.push(PresetEntry {
                id: entry_id,
                key,
                value,
                is_secret,
            });
        }

        Ok(EnvPreset {
            id,
            name,
            entries,
            usages,
            created_at,
            updated_at,
        })
    }

    pub fn create_preset(
        &self,
        name: &str,
        entries: &[PresetEntryInput],
    ) -> CoreResult<EnvPreset> {
        let safe_name = Self::validate_preset_name(name)?;
        let validated = Self::validate_entries(entries)?;
        let preset_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Store secrets first so we fail fast if SecretStore errors
        for entry in &validated {
            if entry.is_secret {
                let secret_key = Self::secret_store_key(&preset_id, &entry.key);
                self.secrets.set(&secret_key, &entry.value)?;
            }
        }

        let db_res = self.db.with_conn(|conn| {
            let dup: Option<String> = conn
                .query_row(
                    "SELECT id FROM preset WHERE LOWER(name) = LOWER(?1)",
                    params![safe_name],
                    |r| r.get(0),
                )
                .optional()?;
            if dup.is_some() {
                return Err(CoreError::Validation(format!(
                    "Preset '{}' already exists",
                    safe_name
                )));
            }

            conn.execute(
                "INSERT INTO preset (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                params![preset_id, safe_name, now, now],
            )?;

            for entry in &validated {
                let entry_id = uuid::Uuid::new_v4().to_string();
                let db_value: Option<&str> = if entry.is_secret {
                    None
                } else {
                    Some(entry.value.as_str())
                };
                conn.execute(
                    "INSERT INTO preset_entry (id, preset_id, key, is_secret, value)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        entry_id,
                        preset_id,
                        entry.key,
                        if entry.is_secret { 1 } else { 0 },
                        db_value
                    ],
                )?;
            }

            Ok(())
        });

        if let Err(err) = db_res {
            // Roll back any secrets written if DB insert failed
            for entry in &validated {
                if entry.is_secret {
                    let _ = self
                        .secrets
                        .delete(&Self::secret_store_key(&preset_id, &entry.key));
                }
            }
            return Err(err);
        }

        self.get_preset(&preset_id)
    }

    pub fn update_preset(
        &self,
        preset_id: &str,
        name: &str,
        entries: &[PresetEntryInput],
    ) -> CoreResult<EnvPreset> {
        let safe_name = Self::validate_preset_name(name)?;
        let validated = Self::validate_entries(entries)?;
        let existing = self.get_preset(preset_id)?;
        let now = chrono::Utc::now().to_rfc3339();

        // Update SecretStore for new/changed secret entries
        let new_secret_keys: HashSet<&str> = validated
            .iter()
            .filter(|e| e.is_secret)
            .map(|e| e.key.as_str())
            .collect();

        for entry in &validated {
            if entry.is_secret {
                let secret_key = Self::secret_store_key(preset_id, &entry.key);
                self.secrets.set(&secret_key, &entry.value)?;
            }
        }

        self.db.with_conn(|conn| {
            let dup: Option<String> = conn
                .query_row(
                    "SELECT id FROM preset WHERE LOWER(name) = LOWER(?1) AND id != ?2",
                    params![safe_name, preset_id],
                    |r| r.get(0),
                )
                .optional()?;
            if dup.is_some() {
                return Err(CoreError::Validation(format!(
                    "Preset '{}' already exists",
                    safe_name
                )));
            }

            conn.execute(
                "UPDATE preset SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![safe_name, now, preset_id],
            )?;
            conn.execute(
                "DELETE FROM preset_entry WHERE preset_id = ?1",
                params![preset_id],
            )?;

            for entry in &validated {
                let entry_id = uuid::Uuid::new_v4().to_string();
                let db_value: Option<&str> = if entry.is_secret {
                    None
                } else {
                    Some(entry.value.as_str())
                };
                conn.execute(
                    "INSERT INTO preset_entry (id, preset_id, key, is_secret, value)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        entry_id,
                        preset_id,
                        entry.key,
                        if entry.is_secret { 1 } else { 0 },
                        db_value
                    ],
                )?;
            }

            Ok(())
        })?;

        // Clean up any old secret keys that were removed or converted to plain
        for old_entry in &existing.entries {
            if old_entry.is_secret && !new_secret_keys.contains(old_entry.key.as_str()) {
                let _ = self
                    .secrets
                    .delete(&Self::secret_store_key(preset_id, &old_entry.key));
            }
        }

        self.get_preset(preset_id)
    }

    pub fn delete_preset(&self, preset_id: &str) -> CoreResult<()> {
        let existing = self.get_preset(preset_id)?;
        for entry in &existing.entries {
            if entry.is_secret {
                let _ = self
                    .secrets
                    .delete(&Self::secret_store_key(preset_id, &entry.key));
            }
        }

        self.db.with_conn(|conn| {
            let affected = conn.execute("DELETE FROM preset WHERE id = ?1", params![preset_id])?;
            if affected == 0 {
                return Err(CoreError::NotFound(format!("Preset not found: {preset_id}")));
            }
            Ok(())
        })
    }

    pub fn list_project_presets(&self, project_id: &str) -> CoreResult<Vec<AttachedPreset>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT p.id, p.name, pp.position,
                        (SELECT COUNT(*) FROM preset_entry pe WHERE pe.preset_id = p.id) AS entry_count,
                        (SELECT COUNT(*) FROM preset_entry pe WHERE pe.preset_id = p.id AND pe.is_secret = 1) AS secret_count
                 FROM project_preset pp
                 JOIN preset p ON p.id = pp.preset_id
                 WHERE pp.project_id = ?1
                 ORDER BY pp.position ASC, p.name ASC",
            )?;
            let rows = stmt
                .query_map(params![project_id], |row| {
                    Ok(AttachedPreset {
                        preset_id: row.get(0)?,
                        preset_name: row.get(1)?,
                        position: row.get(2)?,
                        entry_count: row.get::<_, i64>(3)? as usize,
                        secret_count: row.get::<_, i64>(4)? as usize,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn list_service_presets(&self, service_id: &str) -> CoreResult<Vec<AttachedPreset>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT p.id, p.name, sp.position,
                        (SELECT COUNT(*) FROM preset_entry pe WHERE pe.preset_id = p.id) AS entry_count,
                        (SELECT COUNT(*) FROM preset_entry pe WHERE pe.preset_id = p.id AND pe.is_secret = 1) AS secret_count
                 FROM service_preset sp
                 JOIN preset p ON p.id = sp.preset_id
                 WHERE sp.service_id = ?1
                 ORDER BY sp.position ASC, p.name ASC",
            )?;
            let rows = stmt
                .query_map(params![service_id], |row| {
                    Ok(AttachedPreset {
                        preset_id: row.get(0)?,
                        preset_name: row.get(1)?,
                        position: row.get(2)?,
                        entry_count: row.get::<_, i64>(3)? as usize,
                        secret_count: row.get::<_, i64>(4)? as usize,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn resolve_project_presets_full(&self, project_id: &str) -> CoreResult<Vec<EnvPreset>> {
        let attached = self.list_project_presets(project_id)?;
        let mut result = Vec::with_capacity(attached.len());
        for a in attached {
            result.push(self.get_preset(&a.preset_id)?);
        }
        Ok(result)
    }

    pub fn resolve_service_presets_full(&self, service_id: &str) -> CoreResult<Vec<EnvPreset>> {
        let attached = self.list_service_presets(service_id)?;
        let mut result = Vec::with_capacity(attached.len());
        for a in attached {
            result.push(self.get_preset(&a.preset_id)?);
        }
        Ok(result)
    }

    pub fn attach_preset_to_project(
        &self,
        project_id: &str,
        preset_id: &str,
    ) -> CoreResult<Vec<AttachedPreset>> {
        self.db.with_conn(|conn| {
            let proj_exists: Option<String> = conn
                .query_row(
                    "SELECT id FROM project WHERE id = ?1",
                    params![project_id],
                    |r| r.get(0),
                )
                .optional()?;
            if proj_exists.is_none() {
                return Err(CoreError::NotFound(format!(
                    "Project not found: {project_id}"
                )));
            }

            let preset_exists: Option<String> = conn
                .query_row(
                    "SELECT id FROM preset WHERE id = ?1",
                    params![preset_id],
                    |r| r.get(0),
                )
                .optional()?;
            if preset_exists.is_none() {
                return Err(CoreError::NotFound(format!("Preset not found: {preset_id}")));
            }

            let next_pos: i32 = conn.query_row(
                "SELECT COALESCE(MAX(position) + 1, 0) FROM project_preset WHERE project_id = ?1",
                params![project_id],
                |r| r.get(0),
            )?;

            conn.execute(
                "INSERT OR IGNORE INTO project_preset (project_id, preset_id, position)
                 VALUES (?1, ?2, ?3)",
                params![project_id, preset_id, next_pos],
            )?;
            Ok(())
        })?;
        self.list_project_presets(project_id)
    }

    pub fn detach_preset_from_project(
        &self,
        project_id: &str,
        preset_id: &str,
    ) -> CoreResult<Vec<AttachedPreset>> {
        self.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM project_preset WHERE project_id = ?1 AND preset_id = ?2",
                params![project_id, preset_id],
            )?;
            Ok(())
        })?;
        self.list_project_presets(project_id)
    }

    pub fn reorder_project_presets(
        &self,
        project_id: &str,
        preset_ids: &[String],
    ) -> CoreResult<Vec<AttachedPreset>> {
        self.db.with_conn(|conn| {
            for (idx, preset_id) in preset_ids.iter().enumerate() {
                conn.execute(
                    "UPDATE project_preset SET position = ?1
                     WHERE project_id = ?2 AND preset_id = ?3",
                    params![idx as i32, project_id, preset_id],
                )?;
            }
            Ok(())
        })?;
        self.list_project_presets(project_id)
    }

    pub fn attach_preset_to_service(
        &self,
        service_id: &str,
        preset_id: &str,
    ) -> CoreResult<Vec<AttachedPreset>> {
        self.db.with_conn(|conn| {
            let svc_exists: Option<String> = conn
                .query_row(
                    "SELECT id FROM service WHERE id = ?1",
                    params![service_id],
                    |r| r.get(0),
                )
                .optional()?;
            if svc_exists.is_none() {
                return Err(CoreError::NotFound(format!(
                    "Service not found: {service_id}"
                )));
            }

            let preset_exists: Option<String> = conn
                .query_row(
                    "SELECT id FROM preset WHERE id = ?1",
                    params![preset_id],
                    |r| r.get(0),
                )
                .optional()?;
            if preset_exists.is_none() {
                return Err(CoreError::NotFound(format!("Preset not found: {preset_id}")));
            }

            let next_pos: i32 = conn.query_row(
                "SELECT COALESCE(MAX(position) + 1, 0) FROM service_preset WHERE service_id = ?1",
                params![service_id],
                |r| r.get(0),
            )?;

            conn.execute(
                "INSERT OR IGNORE INTO service_preset (service_id, preset_id, position)
                 VALUES (?1, ?2, ?3)",
                params![service_id, preset_id, next_pos],
            )?;
            Ok(())
        })?;
        self.list_service_presets(service_id)
    }

    pub fn detach_preset_from_service(
        &self,
        service_id: &str,
        preset_id: &str,
    ) -> CoreResult<Vec<AttachedPreset>> {
        self.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM service_preset WHERE service_id = ?1 AND preset_id = ?2",
                params![service_id, preset_id],
            )?;
            Ok(())
        })?;
        self.list_service_presets(service_id)
    }

    pub fn reorder_service_presets(
        &self,
        service_id: &str,
        preset_ids: &[String],
    ) -> CoreResult<Vec<AttachedPreset>> {
        self.db.with_conn(|conn| {
            for (idx, preset_id) in preset_ids.iter().enumerate() {
                conn.execute(
                    "UPDATE service_preset SET position = ?1
                     WHERE service_id = ?2 AND preset_id = ?3",
                    params![idx as i32, service_id, preset_id],
                )?;
            }
            Ok(())
        })?;
        self.list_service_presets(service_id)
    }

    pub fn inspect_project_shared_env(&self, project_id: &str) -> CoreResult<ProjectEnvSummary> {
        let attached = self.list_project_presets(project_id)?;
        let full_presets = self.resolve_project_presets_full(project_id)?;

        // (value, source, is_secret, overridden_sources)
        let mut merged: BTreeMap<String, (String, String, bool, Vec<String>)> = BTreeMap::new();
        for preset in &full_presets {
            for entry in &preset.entries {
                let is_secret =
                    entry.is_secret || EnvResolver::is_secret_like(&entry.key, &entry.value);
                if let Some((prev_val, prev_src, prev_secret, prev_overrides)) =
                    merged.get_mut(&entry.key)
                {
                    prev_overrides.push(prev_src.clone());
                    *prev_val = entry.value.clone();
                    *prev_src = preset.name.clone();
                    *prev_secret = is_secret;
                } else {
                    merged.insert(
                        entry.key.clone(),
                        (entry.value.clone(), preset.name.clone(), is_secret, Vec::new()),
                    );
                }
            }
        }

        let entries = merged
            .into_iter()
            .map(
                |(key, (value, source, is_secret, overridden_sources))| ProjectPresetEnvEntry {
                    key,
                    value,
                    source,
                    is_secret,
                    overridden_sources,
                },
            )
            .collect();

        Ok(ProjectEnvSummary {
            project_id: project_id.to_string(),
            presets: attached,
            entries,
        })
    }
}
