use crate::models::{PluginManifest, PluginValidationReport};
use crate::Result;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub const ALLOWED_PLUGIN_KINDS: &[&str] = &[
    "pipeline",
    "radar",
    "importer",
    "snippets",
    "exporter",
    "automation",
];

fn is_valid_plugin_id(id: &str) -> bool {
    if id.len() < 3 || id.len() > 64 {
        return false;
    }
    let bytes = id.as_bytes();
    if !(bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit()) {
        return false;
    }
    if !(bytes[bytes.len() - 1].is_ascii_lowercase() || bytes[bytes.len() - 1].is_ascii_digit()) {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_valid_semver(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    parts
        .iter()
        .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// Validates a single plugin manifest strictly against the Folklore plugin schema rules.
pub fn validate_manifest(manifest: &PluginManifest, label: &str) -> Vec<String> {
    let mut errors = Vec::new();

    if !is_valid_plugin_id(&manifest.id) {
        errors.push(format!(
            "{}: invalid id '{}' (must be 3-64 chars kebab-case a-z, 0-9, '-')",
            label, manifest.id
        ));
    }
    if manifest.name.trim().is_empty() || manifest.name.len() > 80 {
        errors.push(format!(
            "{}: name must be between 1 and 80 characters",
            label
        ));
    }
    if !is_valid_semver(&manifest.version) {
        errors.push(format!(
            "{}: invalid semver version '{}' (expected MAJOR.MINOR.PATCH)",
            label, manifest.version
        ));
    }
    if !ALLOWED_PLUGIN_KINDS.contains(&manifest.kind.as_str()) {
        errors.push(format!(
            "{}: invalid kind '{}'; allowed: {}",
            label,
            manifest.kind,
            ALLOWED_PLUGIN_KINDS.join(", ")
        ));
    }
    let desc_len = manifest.description.trim().len();
    if !(10..=280).contains(&desc_len) {
        errors.push(format!(
            "{}: description must be between 10 and 280 characters (got {})",
            label, desc_len
        ));
    }
    if manifest.author.trim().is_empty() {
        errors.push(format!("{}: author cannot be empty", label));
    }
    if !manifest.config.is_object() {
        errors.push(format!("{}: config must be a JSON object", label));
    }

    errors
}

/// Loads and validates all `*.json` plugin manifests in `plugins_dir` (ignoring `schema.json`).
pub fn load_plugins_from_dir(
    plugins_dir: &Path,
) -> Result<(Vec<PluginManifest>, PluginValidationReport)> {
    let mut manifests = Vec::new();
    let mut errors = Vec::new();
    let mut valid_count = 0usize;
    let mut invalid_count = 0usize;
    let mut seen_ids: HashSet<String> = HashSet::new();

    if !plugins_dir.exists() {
        return Ok((
            manifests,
            PluginValidationReport {
                valid: 0,
                invalid: 0,
                errors,
            },
        ));
    }

    let mut files: Vec<PathBuf> = fs::read_dir(plugins_dir)?
        .filter_map(|e| e.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|name| name != "schema.json")
        })
        .collect();
    files.sort();

    for path in files {
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("plugin.json")
            .to_string();

        let content = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(err) => {
                invalid_count += 1;
                errors.push(format!("{}: failed to read file: {}", filename, err));
                continue;
            }
        };

        let mut manifest: PluginManifest = match serde_json::from_str(&content) {
            Ok(parsed) => parsed,
            Err(err) => {
                invalid_count += 1;
                errors.push(format!("{}: invalid JSON manifest: {}", filename, err));
                continue;
            }
        };
        manifest.source_file = Some(filename.clone());

        let mut file_errors = validate_manifest(&manifest, &filename);
        if !seen_ids.insert(manifest.id.clone()) {
            file_errors.push(format!(
                "{}: duplicate plugin id '{}'",
                filename, manifest.id
            ));
        }

        if file_errors.is_empty() {
            valid_count += 1;
            manifests.push(manifest);
        } else {
            invalid_count += 1;
            errors.extend(file_errors);
        }
    }

    Ok((
        manifests,
        PluginValidationReport {
            valid: valid_count,
            invalid: invalid_count,
            errors,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_good_and_bad_manifests() {
        let valid = PluginManifest {
            id: "stale-relationship-radar".to_string(),
            name: "Stale Relationship Radar".to_string(),
            version: "1.0.0".to_string(),
            kind: "radar".to_string(),
            description: "Flags open contacts with zero touchpoints over the last 14 days."
                .to_string(),
            author: "xity4uu-a11y".to_string(),
            enabled: true,
            config: json!({ "stale_days": 14 }),
            source_file: Some("stale-relationship-radar.json".to_string()),
        };
        assert!(validate_manifest(&valid, "test").is_empty());

        let invalid = PluginManifest {
            id: "Bad_ID!".to_string(),
            name: String::new(),
            version: "v1".to_string(),
            kind: "unknown".to_string(),
            description: "short".to_string(),
            author: String::new(),
            enabled: true,
            config: json!(["not", "object"]),
            source_file: None,
        };
        let errs = validate_manifest(&invalid, "bad.json");
        assert_eq!(errs.len(), 7);
    }

    #[test]
    fn loads_directory_skips_schema_and_detects_duplicates() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "folklore-plugins-test-{}-{}",
            std::process::id(),
            nanos
        ));
        fs::create_dir_all(&dir).unwrap();

        fs::write(dir.join("schema.json"), r#"{"title":"ignored"}"#).unwrap();
        let manifest = r#"{
            "id": "demo-plugin",
            "name": "Demo Plugin",
            "version": "1.0.0",
            "kind": "radar",
            "description": "Valid test plugin manifest for directory loading.",
            "author": "xity4uu-a11y",
            "enabled": true,
            "config": { "window_days": 7 }
        }"#;
        fs::write(dir.join("a-demo.json"), manifest).unwrap();
        fs::write(dir.join("b-dup.json"), manifest).unwrap();

        let (loaded, report) = load_plugins_from_dir(&dir).expect("load plugins");
        assert_eq!(loaded.len(), 1);
        assert_eq!(report.valid, 1);
        assert_eq!(report.invalid, 1);
        assert!(report.errors[0].contains("duplicate plugin id"));

        let _ = fs::remove_dir_all(&dir);
    }
}
