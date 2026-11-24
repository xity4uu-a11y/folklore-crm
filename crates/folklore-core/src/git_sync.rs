use crate::markdown::{serialize_contact, validate_contact_id};
use crate::models::{
    Contact, GitCommitEntry, GitCommitResult, GitFileChange, GitVaultStatus, Interaction,
    PipelineStage, TaskItem,
};
use crate::{FolkloreError, Result};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

fn run_git(vault_path: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(vault_path)
        .output()
        .map_err(|err| {
            FolkloreError::Git(format!(
                "failed to execute git (ensure git is installed and in PATH): {}",
                err
            ))
        })?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        Err(FolkloreError::Git(format!(
            "git {} failed: {}",
            args.join(" "),
            detail
        )))
    }
}

fn validate_rel_path(rel_path: &str) -> Result<String> {
    let trimmed = rel_path.trim();
    if trimmed.is_empty() {
        return Err(FolkloreError::Validation(
            "relative file path cannot be empty".to_string(),
        ));
    }
    if trimmed.starts_with('-') || trimmed.contains('\0') {
        return Err(FolkloreError::Validation(format!(
            "unsafe relative path '{}'",
            trimmed
        )));
    }
    let normalized = trimmed.replace('\\', "/");
    let candidate = Path::new(&normalized);
    if candidate.is_absolute() {
        return Err(FolkloreError::Validation(format!(
            "path '{}' must be relative to vault root",
            trimmed
        )));
    }
    for comp in candidate.components() {
        match comp {
            Component::Normal(_) => {}
            _ => {
                return Err(FolkloreError::Validation(format!(
                    "path '{}' contains forbidden traversal component",
                    trimmed
                )));
            }
        }
    }
    Ok(normalized)
}

fn validate_contact_rel_path(rel_path: &str) -> Result<String> {
    let normalized = validate_rel_path(rel_path)?;
    let filename = normalized
        .strip_prefix("contacts/")
        .ok_or_else(|| {
            FolkloreError::Validation(format!(
                "path '{}' must reside inside contacts/",
                normalized
            ))
        })?;
    let stem = filename.strip_suffix(".md").ok_or_else(|| {
        FolkloreError::Validation(format!(
            "path '{}' must reference a .md contact file",
            normalized
        ))
    })?;
    if stem.contains('/') {
        return Err(FolkloreError::Validation(format!(
            "nested contact paths are not allowed: '{}'",
            normalized
        )));
    }
    validate_contact_id(stem)?;
    Ok(normalized)
}

fn validate_git_ref(rev: &str, label: &str) -> Result<()> {
    let trimmed = rev.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err(FolkloreError::Validation(format!(
            "invalid {} '{}'",
            label, rev
        )));
    }
    if trimmed.starts_with('-') || trimmed.contains("..") || trimmed.contains(':') {
        return Err(FolkloreError::Validation(format!(
            "unsafe {} '{}'",
            label, rev
        )));
    }
    for ch in trimmed.chars() {
        if !(ch.is_ascii_alphanumeric()
            || matches!(ch, '_' | '.' | '-' | '/' | '~' | '^'))
        {
            return Err(FolkloreError::Validation(format!(
                "invalid character '{}' in {}",
                ch, label
            )));
        }
    }
    Ok(())
}

fn ensure_local_git_identity(vault_path: &Path) -> Result<()> {
    let has_name = run_git(vault_path, &["config", "--get", "user.name"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let has_email = run_git(vault_path, &["config", "--get", "user.email"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    if !has_name {
        run_git(vault_path, &["config", "user.name", "Folklore CRM"])?;
    }
    if !has_email {
        run_git(
            vault_path,
            &["config", "user.email", "vault@folklore.local"],
        )?;
    }
    Ok(())
}

fn starter_contacts() -> Vec<Contact> {
    vec![
        Contact {
            id: "elena-rostova".to_string(),
            name: "Elena Rostova".to_string(),
            email: "elena@northstar.dev".to_string(),
            company: "Northstar Systems".to_string(),
            role: "VP of Engineering".to_string(),
            stage: PipelineStage::Proposal,
            deal_value: 24000.0,
            currency: "USD".to_string(),
            next_followup: Some("2026-12-01".to_string()),
            tags: vec![
                "enterprise".to_string(),
                "security".to_string(),
                "founder-led".to_string(),
            ],
            owner: "founder".to_string(),
            website: "https://northstar.dev".to_string(),
            phone: "+1-415-555-0142".to_string(),
            context: "Evaluating local-first CRM to replace 40 HubSpot seats.\nPrimary requirement is Git-backed audit history and zero SaaS vendor lock-in.".to_string(),
            timeline: vec![
                Interaction {
                    date: "2026-11-20".to_string(),
                    kind: "call".to_string(),
                    note: "Walked through plain-text Markdown schema and instant VS Code sync.".to_string(),
                },
                Interaction {
                    date: "2026-11-12".to_string(),
                    kind: "email".to_string(),
                    note: "Shared security questionnaire and zero-cloud architecture brief.".to_string(),
                },
            ],
            tasks: vec![
                TaskItem {
                    done: false,
                    text: "Send annual support agreement redlines".to_string(),
                },
                TaskItem {
                    done: true,
                    text: "Deliver Git rollback demonstration".to_string(),
                },
            ],
            file_path: "contacts/elena-rostova.md".to_string(),
        },
        Contact {
            id: "marcus-chen".to_string(),
            name: "Marcus Chen".to_string(),
            email: "marcus@foundrylabs.io".to_string(),
            company: "Foundry Labs".to_string(),
            role: "CTO".to_string(),
            stage: PipelineStage::Negotiation,
            deal_value: 18500.0,
            currency: "USD".to_string(),
            next_followup: Some("2026-11-28".to_string()),
            tags: vec!["developer-tools".to_string(), "inbound".to_string()],
            owner: "founder".to_string(),
            website: "https://foundrylabs.io".to_string(),
            phone: "+1-212-555-0199".to_string(),
            context: "Team of 18 engineers migrating outbound pipeline out of Pipedrive.\nPrefers CLI workflows and PR-based review of account notes.".to_string(),
            timeline: vec![Interaction {
                date: "2026-11-18".to_string(),
                kind: "demo".to_string(),
                note: "Demonstrated folklore CLI export and weighted pipeline forecasting.".to_string(),
            }],
            tasks: vec![TaskItem {
                done: false,
                text: "Confirm onboarding workshop date for engineering leads".to_string(),
            }],
            file_path: "contacts/marcus-chen.md".to_string(),
        },
        Contact {
            id: "priya-nair".to_string(),
            name: "Priya Nair".to_string(),
            email: "priya@meridiancloud.co".to_string(),
            company: "Meridian Cloud".to_string(),
            role: "Head of Partnerships".to_string(),
            stage: PipelineStage::Qualified,
            deal_value: 12000.0,
            currency: "USD".to_string(),
            next_followup: Some("2026-12-05".to_string()),
            tags: vec!["partnerships".to_string(), "self-hosted".to_string()],
            owner: "founder".to_string(),
            website: "https://meridiancloud.co".to_string(),
            phone: "+44-20-7946-0912".to_string(),
            context: "Building partner directory across 30 infrastructure consultancies.\nNeeds portable vCard and CSV exports without per-seat fees.".to_string(),
            timeline: vec![Interaction {
                date: "2026-11-15".to_string(),
                kind: "meeting".to_string(),
                note: "Scoped partnership rollout and custom plugin schema requirements.".to_string(),
            }],
            tasks: vec![TaskItem {
                done: false,
                text: "Share sample B2B SaaS pipeline plugin manifest".to_string(),
            }],
            file_path: "contacts/priya-nair.md".to_string(),
        },
    ]
}

/// Initializes a Folklore CRM vault directory with `contacts/`, `.gitignore`,
/// starter contacts (if empty), a local Git repository on `main`, and an initial commit.
pub fn init_vault(vault_path: &Path) -> Result<GitVaultStatus> {
    let contacts_dir = vault_path.join("contacts");
    fs::create_dir_all(&contacts_dir)?;

    let gitignore_path = vault_path.join(".gitignore");
    if !gitignore_path.exists() {
        fs::write(
            &gitignore_path,
            ".DS_Store\nThumbs.db\nDesktop.ini\n.folklore-tmp/\n*.swp\n",
        )?;
    }

    let has_existing_contacts = fs::read_dir(&contacts_dir)?
        .filter_map(|e| e.ok())
        .any(|e| {
            e.path()
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        });

    if !has_existing_contacts {
        for contact in starter_contacts() {
            let md = serialize_contact(&contact)?;
            let target = contacts_dir.join(format!("{}.md", contact.id));
            fs::write(target, md)?;
        }
    }

    if !vault_path.join(".git").exists() {
        run_git(vault_path, &["init", "-b", "main"])?;
    }

    ensure_local_git_identity(vault_path)?;

    let _ = commit_all(vault_path, "chore(vault): initialize folklore crm vault")?;
    vault_status(vault_path)
}

/// Returns current Git repository status for a Folklore vault.
pub fn vault_status(vault_path: &Path) -> Result<GitVaultStatus> {
    let is_repo = run_git(vault_path, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false);

    if !is_repo {
        return Ok(GitVaultStatus {
            is_repo: false,
            branch: "uninitialized".to_string(),
            head_hash: None,
            clean: true,
            modified_files: Vec::new(),
            has_remote: false,
            remote_url: None,
        });
    }

    let branch = run_git(vault_path, &["symbolic-ref", "--short", "HEAD"])
        .or_else(|_| run_git(vault_path, &["rev-parse", "--abbrev-ref", "HEAD"]))
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "main".to_string());

    let head_hash = run_git(vault_path, &["rev-parse", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let porcelain = run_git(vault_path, &["status", "--porcelain=v1", "-uall"])?;
    let mut modified_files = Vec::new();
    for line in porcelain.lines() {
        if line.len() < 4 {
            continue;
        }
        let code = line[..2].trim().to_string();
        let raw_path = line[3..].trim().trim_matches('"').to_string();
        if raw_path.ends_with(".md") || raw_path == ".gitignore" || raw_path.starts_with("contacts/")
        {
            modified_files.push(GitFileChange {
                status: if code.is_empty() {
                    "M".to_string()
                } else {
                    code
                },
                path: raw_path.replace('\\', "/"),
            });
        }
    }

    let remote_url = run_git(vault_path, &["remote", "get-url", "origin"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    Ok(GitVaultStatus {
        is_repo: true,
        branch,
        head_hash,
        clean: modified_files.is_empty(),
        modified_files,
        has_remote: remote_url.is_some(),
        remote_url,
    })
}

/// Stages Markdown contact changes (and `.gitignore`) and commits them with a semantic message.
pub fn commit_all(vault_path: &Path, message: &str) -> Result<GitCommitResult> {
    let trimmed_msg = message.trim();
    if trimmed_msg.is_empty() {
        return Err(FolkloreError::Validation(
            "commit message cannot be empty".to_string(),
        ));
    }

    if !vault_path.join(".git").exists() {
        return Err(FolkloreError::Git(
            "directory is not a git repository; run `folklore init` first".to_string(),
        ));
    }

    ensure_local_git_identity(vault_path)?;

    let mut stage_args = vec!["add", "-A", "--"];
    let contacts_exists = vault_path.join("contacts").exists();
    let gitignore_exists = vault_path.join(".gitignore").exists();
    if contacts_exists {
        stage_args.push("contacts");
    }
    if gitignore_exists {
        stage_args.push(".gitignore");
    }
    if stage_args.len() == 3 {
        stage_args.push(".");
    }
    run_git(vault_path, &stage_args)?;

    let cached_diff = run_git(vault_path, &["diff", "--cached", "--name-only"])?;
    if cached_diff.trim().is_empty() {
        let head = run_git(vault_path, &["rev-parse", "--short", "HEAD"])
            .ok()
            .map(|s| s.trim().to_string());
        return Ok(GitCommitResult {
            committed: false,
            commit_hash: head,
            message: "Working tree clean; nothing to commit.".to_string(),
        });
    }

    run_git(vault_path, &["commit", "-m", trimmed_msg])?;
    let hash = run_git(vault_path, &["rev-parse", "--short", "HEAD"])
        .map(|s| s.trim().to_string())?;

    Ok(GitCommitResult {
        committed: true,
        commit_hash: Some(hash),
        message: trimmed_msg.to_string(),
    })
}

/// Returns per-file Git commit history for a contact Markdown file.
pub fn file_history(
    vault_path: &Path,
    rel_path: &str,
    limit: usize,
) -> Result<Vec<GitCommitEntry>> {
    let safe_path = validate_rel_path(rel_path)?;
    let clamped_limit = limit.clamp(1, 200).to_string();
    let output = run_git(
        vault_path,
        &[
            "log",
            "-n",
            &clamped_limit,
            "--date=iso-strict",
            "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s",
            "--",
            &safe_path,
        ],
    )?;

    let mut entries = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split('\x1f').collect();
        if parts.len() == 5 {
            entries.push(GitCommitEntry {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                author: parts[2].to_string(),
                date: parts[3].to_string(),
                message: parts[4].to_string(),
            });
        }
    }
    Ok(entries)
}

/// Inspects a contact file at a specific Git revision without mutating the working tree.
pub fn show_revision(vault_path: &Path, rev: &str, rel_path: &str) -> Result<String> {
    validate_git_ref(rev, "revision")?;
    let safe_path = validate_contact_rel_path(rel_path)?;
    let spec = format!("{}:{}", rev.trim(), safe_path);
    run_git(vault_path, &["show", &spec])
}

/// Restores a contact file in the working tree to its exact contents at `rev`.
pub fn restore_revision(vault_path: &Path, rev: &str, rel_path: &str) -> Result<String> {
    let safe_path = validate_contact_rel_path(rel_path)?;
    let content = show_revision(vault_path, rev, &safe_path)?;
    let target: PathBuf = vault_path.join(&safe_path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&target, &content)?;
    Ok(content)
}

/// Optional remote pull for users syncing their plain-text vault via GitHub, GitLab, or private Git.
pub fn pull_remote(vault_path: &Path, remote: &str, branch: &str) -> Result<String> {
    validate_git_ref(remote, "remote")?;
    validate_git_ref(branch, "branch")?;
    run_git(vault_path, &["pull", "--rebase", remote.trim(), branch.trim()])
}

/// Optional remote push for users syncing their plain-text vault via GitHub, GitLab, or private Git.
pub fn push_remote(vault_path: &Path, remote: &str, branch: &str) -> Result<String> {
    validate_git_ref(remote, "remote")?;
    validate_git_ref(branch, "branch")?;
    run_git(vault_path, &["push", remote.trim(), branch.trim()])
}

/// Computes a deterministic SHA-256 fingerprint across all `contacts/*.md` filenames and contents.
/// External edits from VS Code, Obsidian, or Vim immediately change this digest.
pub fn vault_fingerprint(vault_path: &Path) -> Result<String> {
    let contacts_dir = vault_path.join("contacts");
    let mut hasher = Sha256::new();
    if !contacts_dir.exists() {
        return Ok(format!("{:x}", hasher.finalize()));
    }

    let mut entries: Vec<(String, PathBuf)> = fs::read_dir(&contacts_dir)?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            if path.is_file()
                && path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
            {
                let name = e.file_name().to_string_lossy().to_string();
                Some((name, path))
            } else {
                None
            }
        })
        .collect();

    entries.sort_by(|a, b| a.0.cmp(&b.0));

    for (name, path) in entries {
        hasher.update(name.as_bytes());
        hasher.update([0u8]);
        let bytes = fs::read(&path)?;
        hasher.update(&bytes);
        hasher.update([0xffu8]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempVault(PathBuf);

    impl TempVault {
        fn new(label: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!(
                "folklore-test-{}-{}-{}",
                label,
                std::process::id(),
                nanos
            ));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempVault {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn real_git_lifecycle_init_commit_history_and_restore() {
        let vault = TempVault::new("lifecycle");
        let status = init_vault(&vault.0).expect("init_vault should succeed");
        assert!(status.is_repo);
        assert_eq!(status.branch, "main");
        assert!(status.clean);
        assert!(status.head_hash.is_some());

        let fp_initial = vault_fingerprint(&vault.0).expect("fingerprint initial");
        assert_eq!(fp_initial.len(), 64);

        let contact_file = vault.0.join("contacts").join("elena-rostova.md");
        let original_text = fs::read_to_string(&contact_file).unwrap();
        assert!(original_text.contains("stage: proposal"));

        // Simulate external VS Code edit moving Elena to won
        let updated_text = original_text.replace("stage: proposal", "stage: won");
        fs::write(&contact_file, &updated_text).unwrap();

        let fp_after_edit = vault_fingerprint(&vault.0).expect("fingerprint after edit");
        assert_ne!(fp_initial, fp_after_edit);

        let dirty_status = vault_status(&vault.0).expect("dirty status");
        assert!(!dirty_status.clean);
        assert!(dirty_status
            .modified_files
            .iter()
            .any(|f| f.path == "contacts/elena-rostova.md"));

        let commit = commit_all(&vault.0, "deal(elena-rostova): move stage from proposal to won")
            .expect("commit should succeed");
        assert!(commit.committed);
        assert!(commit.commit_hash.is_some());

        // Second commit with no changes should be clean no-op
        let noop = commit_all(&vault.0, "chore: no-op").expect("noop should succeed");
        assert!(!noop.committed);

        let history =
            file_history(&vault.0, "contacts/elena-rostova.md", 10).expect("file history");
        assert_eq!(history.len(), 2);
        assert!(history[0].message.contains("proposal to won"));

        let initial_rev = &history[1].hash;
        let old_content = show_revision(&vault.0, initial_rev, "contacts/elena-rostova.md")
            .expect("show old revision");
        assert!(old_content.contains("stage: proposal"));

        let restored = restore_revision(&vault.0, initial_rev, "contacts/elena-rostova.md")
            .expect("restore revision");
        assert!(restored.contains("stage: proposal"));

        let disk_after_restore = fs::read_to_string(&contact_file).unwrap();
        assert!(disk_after_restore.contains("stage: proposal"));
    }

    #[test]
    fn blocks_git_flag_injection_and_path_traversal() {
        let vault = TempVault::new("security");
        init_vault(&vault.0).unwrap();

        assert!(show_revision(&vault.0, "--exec=whoami", "contacts/elena-rostova.md").is_err());
        assert!(show_revision(&vault.0, "HEAD", "../secret.md").is_err());
        assert!(restore_revision(&vault.0, "HEAD", ".gitignore").is_err());
        assert!(file_history(&vault.0, "--all", 5).is_err());
        assert!(pull_remote(&vault.0, "--upload-pack=evil", "main").is_err());
    }
}
