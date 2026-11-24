use crate::git_sync::{vault_fingerprint, vault_status};
use crate::markdown::{parse_contact_markdown, serialize_contact, validate_contact_id};
use crate::models::{
    Contact, DiagnosticSeverity, Interaction, ParseDiagnostic, PipelineStage, StageSummary,
    TagCount, VaultSnapshot, VaultSummary,
};
use crate::{FolkloreError, Result};
use chrono::{NaiveDate, Utc};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_STALE_DAYS: i64 = 14;

fn contact_file_path(vault_path: &Path, id: &str) -> Result<PathBuf> {
    validate_contact_id(id)?;
    Ok(vault_path.join("contacts").join(format!("{}.md", id)))
}

pub fn load_vault(vault_path: &Path) -> Result<VaultSnapshot> {
    let today = Utc::now().date_naive();
    load_vault_at(vault_path, today, DEFAULT_STALE_DAYS)
}

pub fn load_vault_at(
    vault_path: &Path,
    reference_date: NaiveDate,
    stale_days: i64,
) -> Result<VaultSnapshot> {
    let contacts_dir = vault_path.join("contacts");
    let mut contacts = Vec::new();
    let mut diagnostics = Vec::new();

    if contacts_dir.exists() {
        let mut md_files: Vec<PathBuf> = fs::read_dir(&contacts_dir)?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|path| {
                path.is_file()
                    && path
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
            })
            .collect();
        md_files.sort();

        for path in md_files {
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown.md")
                .to_string();
            let fallback_id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("contact")
                .to_ascii_lowercase();
            let rel_path = format!("contacts/{}", file_name);

            match fs::read_to_string(&path) {
                Ok(content) => match parse_contact_markdown(&content, &fallback_id, &rel_path) {
                    Ok(parsed) => {
                        diagnostics.extend(parsed.diagnostics);
                        contacts.push(parsed.contact);
                    }
                    Err(err) => {
                        diagnostics.push(ParseDiagnostic {
                            file: rel_path,
                            line: Some(1),
                            severity: DiagnosticSeverity::Error,
                            message: err.to_string(),
                        });
                    }
                },
                Err(err) => {
                    diagnostics.push(ParseDiagnostic {
                        file: rel_path,
                        line: None,
                        severity: DiagnosticSeverity::Error,
                        message: format!("failed to read file: {}", err),
                    });
                }
            }
        }
    }

    contacts.sort_by_key(|a| a.name.to_lowercase());

    let summary = compute_summary(&contacts, reference_date, stale_days);
    let git_status = vault_status(vault_path)?;
    let fingerprint = vault_fingerprint(vault_path)?;

    Ok(VaultSnapshot {
        vault_path: vault_path.to_string_lossy().to_string(),
        contacts,
        diagnostics,
        summary,
        git_status,
        fingerprint,
    })
}

pub fn read_contact_raw(vault_path: &Path, id: &str) -> Result<String> {
    let path = contact_file_path(vault_path, id)?;
    if !path.exists() {
        return Err(FolkloreError::NotFound(format!(
            "contact '{}' not found at {}",
            id,
            path.display()
        )));
    }
    Ok(fs::read_to_string(path)?)
}

pub fn load_contact(vault_path: &Path, id: &str) -> Result<Contact> {
    let raw = read_contact_raw(vault_path, id)?;
    let rel_path = format!("contacts/{}.md", id);
    let parsed = parse_contact_markdown(&raw, id, &rel_path)?;
    Ok(parsed.contact)
}

pub fn save_contact(vault_path: &Path, contact: &Contact) -> Result<Contact> {
    let path = contact_file_path(vault_path, &contact.id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut normalized = contact.clone();
    normalized.file_path = format!("contacts/{}.md", normalized.id);
    let serialized = serialize_contact(&normalized)?;
    fs::write(&path, serialized)?;
    Ok(normalized)
}

pub fn save_raw_markdown(vault_path: &Path, id: &str, raw: &str) -> Result<Contact> {
    validate_contact_id(id)?;
    let rel_path = format!("contacts/{}.md", id);
    let parsed = parse_contact_markdown(raw, id, &rel_path)?;
    if parsed.contact.id != id {
        return Err(FolkloreError::Validation(format!(
            "frontmatter id '{}' must match file id '{}'",
            parsed.contact.id, id
        )));
    }
    let path = contact_file_path(vault_path, id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let normalized = raw.replace("\r\n", "\n");
    fs::write(&path, normalized)?;
    Ok(parsed.contact)
}

pub fn append_interaction(
    vault_path: &Path,
    id: &str,
    date: &str,
    kind: &str,
    note: &str,
) -> Result<Contact> {
    let trimmed_note = note.trim();
    if trimmed_note.is_empty() {
        return Err(FolkloreError::Validation(
            "interaction note cannot be empty".to_string(),
        ));
    }
    let mut contact = load_contact(vault_path, id)?;
    let entry_date = if date.trim().is_empty() {
        Utc::now().format("%Y-%m-%d").to_string()
    } else {
        date.trim().to_string()
    };
    let entry_kind = if kind.trim().is_empty() {
        "note".to_string()
    } else {
        kind.trim().to_ascii_lowercase()
    };
    contact.timeline.insert(
        0,
        Interaction {
            date: entry_date,
            kind: entry_kind,
            note: trimmed_note.to_string(),
        },
    );
    save_contact(vault_path, &contact)
}

pub fn toggle_task(vault_path: &Path, id: &str, task_index: usize) -> Result<Contact> {
    let mut contact = load_contact(vault_path, id)?;
    let task = contact.tasks.get_mut(task_index).ok_or_else(|| {
        FolkloreError::Validation(format!(
            "task index {} out of range for contact '{}'",
            task_index, id
        ))
    })?;
    task.done = !task.done;
    save_contact(vault_path, &contact)
}

pub fn delete_contact(vault_path: &Path, id: &str) -> Result<()> {
    let path = contact_file_path(vault_path, id)?;
    if !path.exists() {
        return Err(FolkloreError::NotFound(format!(
            "contact '{}' does not exist",
            id
        )));
    }
    fs::remove_file(path)?;
    Ok(())
}

pub fn compute_summary(
    contacts: &[Contact],
    reference_date: NaiveDate,
    stale_days: i64,
) -> VaultSummary {
    let mut open_deals = 0usize;
    let mut total_pipeline_value = 0.0f64;
    let mut weighted_pipeline_value = 0.0f64;
    let mut won_value = 0.0f64;
    let mut overdue_followups = Vec::new();
    let mut due_soon_followups = Vec::new();
    let mut stale_contacts = Vec::new();
    let mut open_tasks_count = 0usize;
    let mut tag_map: BTreeMap<String, usize> = BTreeMap::new();

    let mut stage_buckets: BTreeMap<&'static str, (PipelineStage, usize, f64, f64)> =
        BTreeMap::new();
    for stage in PipelineStage::ALL {
        stage_buckets.insert(stage.as_str(), (stage, 0, 0.0, 0.0));
    }

    for contact in contacts {
        let weighted = contact.deal_value * contact.stage.probability();
        if let Some(bucket) = stage_buckets.get_mut(contact.stage.as_str()) {
            bucket.1 += 1;
            bucket.2 += contact.deal_value;
            bucket.3 += weighted;
        }

        if contact.stage.is_open() {
            if contact.deal_value > 0.0 {
                open_deals += 1;
            }
            total_pipeline_value += contact.deal_value;
            weighted_pipeline_value += weighted;

            if let Some(ref followup_str) = contact.next_followup {
                if let Ok(followup_date) = NaiveDate::parse_from_str(followup_str, "%Y-%m-%d") {
                    let delta_days = (followup_date - reference_date).num_days();
                    if delta_days < 0 {
                        overdue_followups.push(contact.id.clone());
                    } else if delta_days <= 7 {
                        due_soon_followups.push(contact.id.clone());
                    }
                }
            }

            let is_stale = match contact.last_interaction_date() {
                Some(last_str) => match NaiveDate::parse_from_str(last_str, "%Y-%m-%d") {
                    Ok(last_date) => (reference_date - last_date).num_days() > stale_days,
                    Err(_) => true,
                },
                None => true,
            };
            if is_stale {
                stale_contacts.push(contact.id.clone());
            }
        } else if contact.stage == PipelineStage::Won {
            won_value += contact.deal_value;
        }

        open_tasks_count += contact.tasks.iter().filter(|t| !t.done).count();

        for tag in &contact.tags {
            let key = tag.trim().to_ascii_lowercase();
            if !key.is_empty() {
                *tag_map.entry(key).or_insert(0) += 1;
            }
        }
    }

    let stages = PipelineStage::ALL
        .iter()
        .map(|stage| {
            let (_, count, total_value, weighted_value) = stage_buckets[stage.as_str()];
            StageSummary {
                stage: *stage,
                count,
                total_value,
                weighted_value,
                probability: stage.probability(),
            }
        })
        .collect();

    let mut tag_counts: Vec<TagCount> = tag_map
        .into_iter()
        .map(|(tag, count)| TagCount { tag, count })
        .collect();
    tag_counts.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));

    VaultSummary {
        total_contacts: contacts.len(),
        open_deals,
        total_pipeline_value,
        weighted_pipeline_value,
        won_value,
        overdue_followups,
        due_soon_followups,
        stale_contacts,
        open_tasks_count,
        stages,
        tag_counts,
    }
}

/// Neutralizes spreadsheet formula injection (OWASP CSV Injection defense)
/// before applying RFC 4180 CSV quoting.
pub fn sanitize_csv_field(raw: &str) -> String {
    let trimmed_start = raw.trim_start_matches([' ', '\t']);
    let dangerous = raw.starts_with(['=', '+', '-', '@', '\t', '\r'])
        || trimmed_start.starts_with(['=', '+', '-', '@']);
    let neutralized = if dangerous {
        format!("'{}", raw)
    } else {
        raw.to_string()
    };

    if neutralized.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", neutralized.replace('"', "\"\""))
    } else {
        neutralized
    }
}

/// Exports contacts to RFC 4180 CSV with formula-injection neutralization.
pub fn export_csv(contacts: &[Contact]) -> String {
    let mut lines = Vec::with_capacity(contacts.len() + 1);
    lines.push(
        "id,name,email,company,role,stage,deal_value,currency,next_followup,tags,owner,website,phone,last_contacted,open_tasks"
            .to_string(),
    );

    for c in contacts {
        let open_tasks = c.tasks.iter().filter(|t| !t.done).count();
        let deal_str = if (c.deal_value - c.deal_value.round()).abs() < 1e-6 {
            format!("{}", c.deal_value.round() as i64)
        } else {
            format!("{:.2}", c.deal_value)
        };
        let row = [
            sanitize_csv_field(&c.id),
            sanitize_csv_field(&c.name),
            sanitize_csv_field(&c.email),
            sanitize_csv_field(&c.company),
            sanitize_csv_field(&c.role),
            sanitize_csv_field(c.stage.as_str()),
            deal_str,
            sanitize_csv_field(&c.currency),
            sanitize_csv_field(c.next_followup.as_deref().unwrap_or("")),
            sanitize_csv_field(&c.tags.join("; ")),
            sanitize_csv_field(&c.owner),
            sanitize_csv_field(&c.website),
            sanitize_csv_field(&c.phone),
            sanitize_csv_field(c.last_interaction_date().unwrap_or("")),
            open_tasks.to_string(),
        ]
        .join(",");
        lines.push(row);
    }

    lines.join("\n") + "\n"
}

fn escape_vcard(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\r', "")
        .replace('\n', "\\n")
        .replace(',', "\\,")
        .replace(';', "\\;")
}

/// Exports contacts to standard RFC 6350 vCard 4.0 (`.vcf`) format.
pub fn export_vcard(contacts: &[Contact]) -> String {
    let mut out = String::new();
    for c in contacts {
        let parts: Vec<&str> = c.name.split_whitespace().collect();
        let (first, last) = match parts.as_slice() {
            [] => ("", ""),
            [only] => (*only, ""),
            [first, rest @ ..] => (*first, *rest.last().unwrap_or(&"")),
        };

        out.push_str("BEGIN:VCARD\r\n");
        out.push_str("VERSION:4.0\r\n");
        out.push_str(&format!("UID:urn:folklore:{}\r\n", escape_vcard(&c.id)));
        out.push_str(&format!("FN:{}\r\n", escape_vcard(&c.name)));
        out.push_str(&format!(
            "N:{};{};;;\r\n",
            escape_vcard(last),
            escape_vcard(first)
        ));
        if !c.company.is_empty() {
            out.push_str(&format!("ORG:{}\r\n", escape_vcard(&c.company)));
        }
        if !c.role.is_empty() {
            out.push_str(&format!("TITLE:{}\r\n", escape_vcard(&c.role)));
        }
        if !c.email.is_empty() {
            out.push_str(&format!(
                "EMAIL;TYPE=work:{}\r\n",
                escape_vcard(&c.email)
            ));
        }
        if !c.phone.is_empty() {
            out.push_str(&format!("TEL;TYPE=work:{}\r\n", escape_vcard(&c.phone)));
        }
        if !c.website.is_empty() {
            out.push_str(&format!("URL:{}\r\n", escape_vcard(&c.website)));
        }
        if !c.tags.is_empty() {
            let escaped_tags: Vec<String> = c.tags.iter().map(|t| escape_vcard(t)).collect();
            out.push_str(&format!("CATEGORIES:{}\r\n", escaped_tags.join(",")));
        }
        let mut note_parts = vec![format!(
            "Stage: {} | Deal: {} {}",
            c.stage.as_str(),
            c.currency,
            c.deal_value.round() as i64
        )];
        if !c.context.trim().is_empty() {
            note_parts.push(c.context.trim().to_string());
        }
        out.push_str(&format!("NOTE:{}\r\n", escape_vcard(&note_parts.join("\n"))));
        out.push_str("END:VCARD\r\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TaskItem;

    fn make_contact(
        id: &str,
        name: &str,
        stage: PipelineStage,
        value: f64,
        followup: Option<&str>,
        last_touch: Option<&str>,
        tags: &[&str],
    ) -> Contact {
        Contact {
            id: id.to_string(),
            name: name.to_string(),
            email: format!("{}@example.com", id),
            company: "Acme Corp".to_string(),
            role: "VP".to_string(),
            stage,
            deal_value: value,
            currency: "USD".to_string(),
            next_followup: followup.map(|s| s.to_string()),
            tags: tags.iter().map(|s| s.to_string()).collect(),
            owner: "founder".to_string(),
            website: "https://example.com".to_string(),
            phone: "+1-415-555-0100".to_string(),
            context: "Key evaluation notes.".to_string(),
            timeline: last_touch
                .map(|d| {
                    vec![Interaction {
                        date: d.to_string(),
                        kind: "call".to_string(),
                        note: "Checked in".to_string(),
                    }]
                })
                .unwrap_or_default(),
            tasks: vec![TaskItem {
                done: false,
                text: "Send proposal".to_string(),
            }],
            file_path: format!("contacts/{}.md", id),
        }
    }

    #[test]
    fn computes_weighted_pipeline_overdue_and_stale_radar() {
        let contacts = vec![
            make_contact(
                "overdue-stale",
                "Elena",
                PipelineStage::Proposal,
                20000.0,
                Some("2026-11-10"),
                Some("2026-11-01"),
                &["enterprise", "security"],
            ),
            make_contact(
                "active-deal",
                "Marcus",
                PipelineStage::Negotiation,
                10000.0,
                Some("2026-11-27"),
                Some("2026-11-22"),
                &["enterprise"],
            ),
            make_contact(
                "closed-won",
                "Priya",
                PipelineStage::Won,
                15000.0,
                None,
                Some("2026-10-01"),
                &["saas"],
            ),
        ];

        let today = NaiveDate::from_ymd_opt(2026, 11, 25).unwrap();
        let summary = compute_summary(&contacts, today, 14);

        assert_eq!(summary.total_contacts, 3);
        assert_eq!(summary.open_deals, 2);
        assert_eq!(summary.total_pipeline_value, 30000.0);
        // 20000 * 0.60 + 10000 * 0.80 = 12000 + 8000 = 20000
        assert!((summary.weighted_pipeline_value - 20000.0).abs() < 1e-6);
        assert_eq!(summary.won_value, 15000.0);
        assert_eq!(summary.overdue_followups, vec!["overdue-stale"]);
        assert_eq!(summary.due_soon_followups, vec!["active-deal"]);
        assert_eq!(summary.stale_contacts, vec!["overdue-stale"]);
        assert_eq!(summary.open_tasks_count, 3);
        assert_eq!(summary.tag_counts[0].tag, "enterprise");
        assert_eq!(summary.tag_counts[0].count, 2);
    }

    #[test]
    fn csv_export_neutralizes_formula_injection() {
        let mut evil = make_contact(
            "evil-lead",
            "=CMD|' /C calc'!A0",
            PipelineStage::Lead,
            5000.0,
            None,
            None,
            &["@SUM(A1:A2)"],
        );
        evil.company = "-2+3, Inc".to_string();
        evil.phone = "+1-415-555-0142".to_string();

        let csv = export_csv(&[evil]);
        assert!(csv.contains("'=CMD|' /C calc'!A0"));
        assert!(csv.contains("\"'-2+3, Inc\""));
        assert!(csv.contains("'+1-415-555-0142"));
        assert!(csv.contains("'@SUM(A1:A2)"));
    }

    #[test]
    fn vcard_export_produces_valid_rfc6350_blocks() {
        let contact = make_contact(
            "elena-rostova",
            "Elena Rostova",
            PipelineStage::Proposal,
            24000.0,
            None,
            Some("2026-11-20"),
            &["enterprise", "security"],
        );
        let vcf = export_vcard(&[contact]);
        assert!(vcf.starts_with("BEGIN:VCARD\r\nVERSION:4.0\r\n"));
        assert!(vcf.contains("UID:urn:folklore:elena-rostova\r\n"));
        assert!(vcf.contains("FN:Elena Rostova\r\n"));
        assert!(vcf.contains("N:Rostova;Elena;;;\r\n"));
        assert!(vcf.contains("CATEGORIES:enterprise,security\r\n"));
        assert!(vcf.ends_with("END:VCARD\r\n"));
    }

    #[test]
    fn vault_crud_append_interaction_and_toggle_task() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "folklore-vault-crud-{}-{}",
            std::process::id(),
            nanos
        ));
        fs::create_dir_all(&dir).unwrap();

        let contact = make_contact(
            "nadia-okafor",
            "Nadia Okafor",
            PipelineStage::Qualified,
            14000.0,
            Some("2026-12-03"),
            Some("2026-11-21"),
            &["enterprise"],
        );
        save_contact(&dir, &contact).expect("save contact");

        let after_log = append_interaction(
            &dir,
            "nadia-okafor",
            "2026-11-24",
            "call",
            "Aligned on Q1 rollout milestones",
        )
        .expect("append interaction");
        assert_eq!(after_log.timeline.len(), 2);
        assert_eq!(after_log.timeline[0].date, "2026-11-24");

        let after_toggle = toggle_task(&dir, "nadia-okafor", 0).expect("toggle task");
        assert!(after_toggle.tasks[0].done);

        let raw = read_contact_raw(&dir, "nadia-okafor").expect("read raw");
        let edited = raw.replace("stage: qualified", "stage: proposal");
        let after_raw = save_raw_markdown(&dir, "nadia-okafor", &edited).expect("save raw");
        assert_eq!(after_raw.stage, PipelineStage::Proposal);

        let snap = load_vault(&dir).expect("load vault");
        assert_eq!(snap.contacts.len(), 1);
        assert_eq!(snap.contacts[0].stage, PipelineStage::Proposal);

        delete_contact(&dir, "nadia-okafor").expect("delete contact");
        assert!(load_contact(&dir, "nadia-okafor").is_err());

        let _ = fs::remove_dir_all(&dir);
    }
}
