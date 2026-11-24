use crate::models::{
    Contact, DiagnosticSeverity, Interaction, ParseDiagnostic, PipelineStage, TaskItem,
};
use crate::{FolkloreError, Result};
use std::collections::BTreeMap;
use std::str::FromStr;

pub const MAX_CONTACT_ID_LEN: usize = 96;

/// Validates a contact identifier to strictly prevent path traversal, shell tricks,
/// or filesystem-unsafe filenames across Windows, macOS, and Linux.
pub fn validate_contact_id(id: &str) -> Result<()> {
    if id.is_empty() {
        return Err(FolkloreError::Validation(
            "contact id cannot be empty".to_string(),
        ));
    }
    if id.len() > MAX_CONTACT_ID_LEN {
        return Err(FolkloreError::Validation(format!(
            "contact id exceeds maximum length of {} characters",
            MAX_CONTACT_ID_LEN
        )));
    }
    if id.contains("..") || id.contains('/') || id.contains('\\') || id.contains('\0') {
        return Err(FolkloreError::Validation(format!(
            "contact id '{}' contains forbidden path characters",
            id
        )));
    }
    let bytes = id.as_bytes();
    if !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit() {
        return Err(FolkloreError::Validation(format!(
            "contact id '{}' must start with a lowercase letter or digit",
            id
        )));
    }
    for ch in id.chars() {
        if !(ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '_') {
            return Err(FolkloreError::Validation(format!(
                "contact id '{}' contains invalid character '{}'; allowed: a-z, 0-9, '-', '_'",
                id, ch
            )));
        }
    }
    // Reject Windows reserved device names regardless of OS for cross-platform Git vaults
    let upper = id.to_ascii_uppercase();
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&upper.as_str()) {
        return Err(FolkloreError::Validation(format!(
            "contact id '{}' is a reserved filesystem name",
            id
        )));
    }
    Ok(())
}

/// Converts a display name or arbitrary string into a safe kebab-case contact id.
pub fn slugify(input: &str) -> String {
    let mut slug = String::with_capacity(input.len());
    let mut prev_hyphen = true;
    for ch in input.chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_lowercase() || lower.is_ascii_digit() {
            slug.push(lower);
            prev_hyphen = false;
        } else if !prev_hyphen && !slug.is_empty() {
            slug.push('-');
            prev_hyphen = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.len() > 64 {
        slug.truncate(64);
        while slug.ends_with('-') {
            slug.pop();
        }
    }
    if slug.is_empty() {
        "contact".to_string()
    } else {
        slug
    }
}

#[derive(Debug, Clone)]
pub struct ParsedContact {
    pub contact: Contact,
    pub diagnostics: Vec<ParseDiagnostic>,
}

/// Parses an Obsidian / VS Code-compatible Markdown file with YAML frontmatter into a `Contact`.
pub fn parse_contact_markdown(
    content: &str,
    fallback_id: &str,
    file_path: &str,
) -> Result<ParsedContact> {
    let clean = content.strip_prefix('\u{feff}').unwrap_or(content);
    let normalized = clean.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.lines().collect();
    let mut diagnostics = Vec::new();

    if lines.first().map(|l| l.trim()) != Some("---") {
        return Err(FolkloreError::Parse(format!(
            "{}: missing opening YAML frontmatter delimiter '---'",
            file_path
        )));
    }

    let closing_idx = lines
        .iter()
        .enumerate()
        .skip(1)
        .find(|(_, line)| line.trim() == "---")
        .map(|(idx, _)| idx)
        .ok_or_else(|| {
            FolkloreError::Parse(format!(
                "{}: missing closing YAML frontmatter delimiter '---'",
                file_path
            ))
        })?;

    let frontmatter_lines = &lines[1..closing_idx];
    let (scalars, lists) = parse_yaml_frontmatter(frontmatter_lines, file_path, &mut diagnostics);

    let raw_id = scalars
        .get("id")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback_id.to_string());
    validate_contact_id(&raw_id)?;

    let name = scalars
        .get("name")
        .cloned()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            diagnostics.push(ParseDiagnostic {
                file: file_path.to_string(),
                line: Some(1),
                severity: DiagnosticSeverity::Warning,
                message: "missing 'name' field in frontmatter; falling back to id".to_string(),
            });
            raw_id.clone()
        });

    let stage = match scalars.get("stage") {
        Some(raw_stage) if !raw_stage.trim().is_empty() => match PipelineStage::from_str(raw_stage)
        {
            Ok(parsed) => parsed,
            Err(err) => {
                diagnostics.push(ParseDiagnostic {
                    file: file_path.to_string(),
                    line: None,
                    severity: DiagnosticSeverity::Warning,
                    message: format!("{}; defaulting to 'lead'", err),
                });
                PipelineStage::Lead
            }
        },
        _ => PipelineStage::Lead,
    };

    let deal_value = match scalars.get("deal_value") {
        Some(raw) if !raw.trim().is_empty() => {
            let cleaned = raw.trim().replace([',', '$', ' '], "");
            match cleaned.parse::<f64>() {
                Ok(v) if v.is_finite() && v >= 0.0 => v,
                _ => {
                    diagnostics.push(ParseDiagnostic {
                        file: file_path.to_string(),
                        line: None,
                        severity: DiagnosticSeverity::Warning,
                        message: format!(
                            "invalid deal_value '{}'; defaulting to 0",
                            raw.trim()
                        ),
                    });
                    0.0
                }
            }
        }
        _ => 0.0,
    };

    let currency = scalars
        .get("currency")
        .map(|s| s.trim().to_ascii_uppercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "USD".to_string());

    let next_followup = scalars
        .get("next_followup")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "null" && s != "~");

    let tags = if let Some(list) = lists.get("tags") {
        list.clone()
    } else if let Some(inline) = scalars.get("tags") {
        parse_inline_list(inline)
    } else {
        Vec::new()
    };

    let body_lines = &lines[closing_idx + 1..];
    let (context, timeline, tasks) =
        parse_markdown_sections(body_lines, closing_idx + 2, file_path, &mut diagnostics);

    let contact = Contact {
        id: raw_id,
        name,
        email: scalars.get("email").cloned().unwrap_or_default(),
        company: scalars.get("company").cloned().unwrap_or_default(),
        role: scalars.get("role").cloned().unwrap_or_default(),
        stage,
        deal_value,
        currency,
        next_followup,
        tags,
        owner: scalars
            .get("owner")
            .cloned()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "founder".to_string()),
        website: scalars.get("website").cloned().unwrap_or_default(),
        phone: scalars.get("phone").cloned().unwrap_or_default(),
        context,
        timeline,
        tasks,
        file_path: file_path.to_string(),
    };

    Ok(ParsedContact {
        contact,
        diagnostics,
    })
}

fn parse_yaml_frontmatter(
    lines: &[&str],
    file_path: &str,
    diagnostics: &mut Vec<ParseDiagnostic>,
) -> (BTreeMap<String, String>, BTreeMap<String, Vec<String>>) {
    let mut scalars: BTreeMap<String, String> = BTreeMap::new();
    let mut lists: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut active_list_key: Option<String> = None;

    for (offset, raw_line) in lines.iter().enumerate() {
        let line_no = offset + 2;
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some(item_rest) = trimmed.strip_prefix("- ") {
            if let Some(ref key) = active_list_key {
                let value = unquote_yaml(item_rest.trim());
                if !value.is_empty() {
                    lists.entry(key.clone()).or_default().push(value);
                }
                continue;
            }
        }

        active_list_key = None;

        if let Some((raw_key, raw_val)) = raw_line.split_once(':') {
            let key = raw_key.trim().to_ascii_lowercase();
            let val = raw_val.trim();
            if val.is_empty() {
                active_list_key = Some(key.clone());
                scalars.insert(key, String::new());
            } else if val.starts_with('[') && val.ends_with(']') {
                lists.insert(key, parse_inline_list(val));
            } else {
                scalars.insert(key, unquote_yaml(val));
            }
        } else {
            diagnostics.push(ParseDiagnostic {
                file: file_path.to_string(),
                line: Some(line_no),
                severity: DiagnosticSeverity::Warning,
                message: format!("ignoring malformed frontmatter line: '{}'", trimmed),
            });
        }
    }

    (scalars, lists)
}

fn parse_inline_list(raw: &str) -> Vec<String> {
    let inner = raw
        .trim()
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(raw.trim());

    let mut items = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;

    for ch in inner.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' && in_double {
            escaped = true;
            current.push(ch);
            continue;
        }
        if ch == '\'' && !in_double {
            in_single = !in_single;
            current.push(ch);
            continue;
        }
        if ch == '"' && !in_single {
            in_double = !in_double;
            current.push(ch);
            continue;
        }
        if ch == ',' && !in_single && !in_double {
            let cleaned = unquote_yaml(current.trim());
            if !cleaned.is_empty() {
                items.push(cleaned);
            }
            current.clear();
            continue;
        }
        current.push(ch);
    }

    let tail = unquote_yaml(current.trim());
    if !tail.is_empty() {
        items.push(tail);
    }

    items
}

fn unquote_yaml(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        let inner = &trimmed[1..trimmed.len() - 1];
        let mut out = String::with_capacity(inner.len());
        let mut chars = inner.chars();
        while let Some(ch) = chars.next() {
            if ch == '\\' {
                match chars.next() {
                    Some('"') => out.push('"'),
                    Some('\\') => out.push('\\'),
                    Some('n') => out.push('\n'),
                    Some('t') => out.push('\t'),
                    Some(other) => {
                        out.push('\\');
                        out.push(other);
                    }
                    None => out.push('\\'),
                }
            } else {
                out.push(ch);
            }
        }
        return out;
    }
    if trimmed.len() >= 2 && trimmed.starts_with('\'') && trimmed.ends_with('\'') {
        let inner = &trimmed[1..trimmed.len() - 1];
        return inner.replace("''", "'");
    }
    trimmed.to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Section {
    None,
    Context,
    Timeline,
    Tasks,
}

fn parse_markdown_sections(
    body_lines: &[&str],
    start_line_no: usize,
    file_path: &str,
    diagnostics: &mut Vec<ParseDiagnostic>,
) -> (String, Vec<Interaction>, Vec<TaskItem>) {
    let mut section = Section::None;
    let mut context_lines: Vec<String> = Vec::new();
    let mut timeline: Vec<Interaction> = Vec::new();
    let mut tasks: Vec<TaskItem> = Vec::new();

    for (idx, line) in body_lines.iter().enumerate() {
        let line_no = start_line_no + idx;
        let trimmed = line.trim();

        if let Some(heading) = trimmed.strip_prefix("## ") {
            match heading.trim().to_ascii_lowercase().as_str() {
                "context" | "notes" => {
                    section = Section::Context;
                    continue;
                }
                "timeline" | "interactions" | "activity" => {
                    section = Section::Timeline;
                    continue;
                }
                "tasks" | "next steps" | "todos" => {
                    section = Section::Tasks;
                    continue;
                }
                _ => {
                    if section == Section::Context {
                        context_lines.push((*line).to_string());
                    }
                    continue;
                }
            }
        }

        match section {
            Section::None => {
                if !trimmed.is_empty() {
                    section = Section::Context;
                    context_lines.push((*line).to_string());
                }
            }
            Section::Context => {
                context_lines.push((*line).to_string());
            }
            Section::Timeline => {
                if trimmed.is_empty() {
                    continue;
                }
                if let Some(rest) = trimmed.strip_prefix("- ") {
                    let parts: Vec<&str> = rest.splitn(3, '|').collect();
                    if parts.len() == 3 {
                        let date = parts[0].trim().to_string();
                        let kind = parts[1].trim().to_ascii_lowercase();
                        let note = parts[2].trim().to_string();
                        timeline.push(Interaction { date, kind, note });
                    } else {
                        diagnostics.push(ParseDiagnostic {
                            file: file_path.to_string(),
                            line: Some(line_no),
                            severity: DiagnosticSeverity::Warning,
                            message: format!(
                                "malformed timeline entry '{}'; expected '- YYYY-MM-DD | kind | note'",
                                trimmed
                            ),
                        });
                    }
                } else {
                    diagnostics.push(ParseDiagnostic {
                        file: file_path.to_string(),
                        line: Some(line_no),
                        severity: DiagnosticSeverity::Warning,
                        message: format!("unexpected line in Timeline section: '{}'", trimmed),
                    });
                }
            }
            Section::Tasks => {
                if trimmed.is_empty() {
                    continue;
                }
                if let Some(text) = trimmed.strip_prefix("- [ ] ") {
                    tasks.push(TaskItem {
                        done: false,
                        text: text.trim().to_string(),
                    });
                } else if let Some(text) = trimmed
                    .strip_prefix("- [x] ")
                    .or_else(|| trimmed.strip_prefix("- [X] "))
                {
                    tasks.push(TaskItem {
                        done: true,
                        text: text.trim().to_string(),
                    });
                } else if let Some(text) = trimmed.strip_prefix("- ") {
                    tasks.push(TaskItem {
                        done: false,
                        text: text.trim().to_string(),
                    });
                }
            }
        }
    }

    // Trim leading and trailing blank lines from Context section cleanly
    while context_lines.first().is_some_and(|l| l.trim().is_empty()) {
        context_lines.remove(0);
    }
    while context_lines.last().is_some_and(|l| l.trim().is_empty()) {
        context_lines.pop();
    }

    (context_lines.join("\n"), timeline, tasks)
}

fn format_yaml_scalar(value: &str) -> String {
    if value.is_empty() {
        return "\"\"".to_string();
    }
    let lower = value.to_ascii_lowercase();
    let is_yaml_keyword = matches!(
        lower.as_str(),
        "true" | "false" | "null" | "~" | "yes" | "no" | "on" | "off"
    );
    let needs_quotes = is_yaml_keyword
        || value.starts_with(' ')
        || value.ends_with(' ')
        || value.contains(": ")
        || value.ends_with(':')
        || value.contains(" #")
        || value.starts_with('#')
        || value.contains('\n')
        || value.contains('"')
        || value.contains('\'')
        || value.contains('[')
        || value.contains(']')
        || value.contains('{')
        || value.contains('}')
        || value.starts_with('@')
        || value.starts_with('!')
        || value.starts_with('*')
        || value.starts_with('&')
        || value.starts_with('|')
        || value.starts_with('>')
        || value.starts_with('?')
        || value.starts_with('%')
        || value.starts_with('`')
        || value.starts_with(',');

    if !needs_quotes {
        return value.to_string();
    }

    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\t', "\\t");
    format!("\"{}\"", escaped)
}

fn format_deal_value(value: f64) -> String {
    if (value - value.round()).abs() < 1e-6 {
        format!("{}", value.round() as i64)
    } else {
        format!("{:.2}", value)
    }
}

/// Serializes a `Contact` into canonical, Git-diff-friendly YAML Frontmatter + Markdown.
pub fn serialize_contact(contact: &Contact) -> Result<String> {
    validate_contact_id(&contact.id)?;

    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&format!("id: {}\n", contact.id));
    out.push_str(&format!("name: {}\n", format_yaml_scalar(&contact.name)));
    out.push_str(&format!("email: {}\n", format_yaml_scalar(&contact.email)));
    out.push_str(&format!(
        "company: {}\n",
        format_yaml_scalar(&contact.company)
    ));
    out.push_str(&format!("role: {}\n", format_yaml_scalar(&contact.role)));
    out.push_str(&format!("stage: {}\n", contact.stage.as_str()));
    out.push_str(&format!(
        "deal_value: {}\n",
        format_deal_value(contact.deal_value.max(0.0))
    ));
    let currency = if contact.currency.trim().is_empty() {
        "USD"
    } else {
        contact.currency.trim()
    };
    out.push_str(&format!("currency: {}\n", currency.to_ascii_uppercase()));
    match &contact.next_followup {
        Some(date) if !date.trim().is_empty() => {
            out.push_str(&format!("next_followup: {}\n", date.trim()));
        }
        _ => {
            out.push_str("next_followup: \"\"\n");
        }
    }

    let formatted_tags: Vec<String> = contact
        .tags
        .iter()
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .map(format_yaml_scalar)
        .collect();
    out.push_str(&format!("tags: [{}]\n", formatted_tags.join(", ")));

    let owner = if contact.owner.trim().is_empty() {
        "founder"
    } else {
        contact.owner.trim()
    };
    out.push_str(&format!("owner: {}\n", format_yaml_scalar(owner)));
    out.push_str(&format!(
        "website: {}\n",
        format_yaml_scalar(&contact.website)
    ));
    out.push_str(&format!("phone: {}\n", format_yaml_scalar(&contact.phone)));
    out.push_str("---\n\n");

    out.push_str("## Context\n");
    if !contact.context.trim().is_empty() {
        out.push_str(contact.context.trim());
        out.push('\n');
    }
    out.push('\n');

    out.push_str("## Timeline\n");
    for item in &contact.timeline {
        let safe_note = item.note.replace('\n', " ").replace('\r', "");
        let safe_kind = item.kind.trim().to_ascii_lowercase();
        out.push_str(&format!(
            "- {} | {} | {}\n",
            item.date.trim(),
            if safe_kind.is_empty() {
                "note"
            } else {
                &safe_kind
            },
            safe_note.trim()
        ));
    }
    out.push('\n');

    out.push_str("## Tasks\n");
    for task in &contact.tasks {
        let marker = if task.done { "x" } else { " " };
        let safe_text = task.text.replace('\n', " ").replace('\r', "");
        out.push_str(&format!("- [{}] {}\n", marker, safe_text.trim()));
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_contact() -> Contact {
        Contact {
            id: "elena-rostova".to_string(),
            name: "Elena Rostova".to_string(),
            email: "elena@northstar.dev".to_string(),
            company: "Northstar Systems: Security".to_string(),
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
            context: "Evaluating self-hosted CRM replacement for 45 engineers.\nRequires Git audit trail and zero SaaS lock-in.".to_string(),
            timeline: vec![
                Interaction {
                    date: "2026-11-20".to_string(),
                    kind: "call".to_string(),
                    note: "Reviewed SOC2 readiness and plain-text vault sync.".to_string(),
                },
                Interaction {
                    date: "2026-11-12".to_string(),
                    kind: "email".to_string(),
                    note: "Sent benchmark comparison against HubSpot Enterprise.".to_string(),
                },
            ],
            tasks: vec![
                TaskItem {
                    done: false,
                    text: "Deliver annual redlines before Friday".to_string(),
                },
                TaskItem {
                    done: true,
                    text: "Share Git rollback walkthrough".to_string(),
                },
            ],
            file_path: "contacts/elena-rostova.md".to_string(),
        }
    }

    #[test]
    fn lossless_roundtrip_serialization() {
        let original = sample_contact();
        let md = serialize_contact(&original).expect("serialize should succeed");
        let parsed = parse_contact_markdown(&md, "elena-rostova", "contacts/elena-rostova.md")
            .expect("parse should succeed");

        assert!(parsed.diagnostics.is_empty(), "diagnostics: {:?}", parsed.diagnostics);
        assert_eq!(parsed.contact, original);

        let reserialized = serialize_contact(&parsed.contact).expect("reserialize");
        assert_eq!(md, reserialized);
    }

    #[test]
    fn handles_crlf_and_block_yaml_tags() {
        let raw = "---\r\nid: marcus-chen\r\nname: \"Marcus Chen\"\r\nemail: marcus@foundry.io\r\ncompany: Foundry\r\nrole: CTO\r\nstage: negotiation\r\ndeal_value: 18500.50\r\ncurrency: usd\r\nnext_followup: 2026-11-29\r\ntags:\r\n  - inbound\r\n  - developer-tools\r\nowner: founder\r\nwebsite: https://foundry.io\r\nphone: +1-212-555-0199\r\n---\r\n\r\n## Context\r\nWarm intro from architecture meetup.\r\n\r\n## Timeline\r\n- 2026-11-18 | demo | Walked through CLI export and Git history.\r\n\r\n## Tasks\r\n- [X] Send starter vault archive\r\n- [ ] Confirm procurement sign-off\r\n";

        let parsed = parse_contact_markdown(raw, "fallback", "contacts/marcus-chen.md")
            .expect("should parse CRLF");
        assert!(parsed.diagnostics.is_empty());
        assert_eq!(parsed.contact.id, "marcus-chen");
        assert_eq!(parsed.contact.stage, PipelineStage::Negotiation);
        assert_eq!(parsed.contact.deal_value, 18500.50);
        assert_eq!(parsed.contact.currency, "USD");
        assert_eq!(parsed.contact.tags, vec!["inbound", "developer-tools"]);
        assert_eq!(parsed.contact.tasks.len(), 2);
        assert!(parsed.contact.tasks[0].done);
        assert!(!parsed.contact.tasks[1].done);
    }

    #[test]
    fn rejects_path_traversal_and_unsafe_ids() {
        let bad_ids = [
            "",
            "../secret",
            "nested/contact",
            "win\\path",
            "null\0byte",
            ".hidden",
            "-leading-dash",
            "UpperCase",
            "has space",
            "con",
            "aux",
        ];
        for id in bad_ids {
            assert!(
                validate_contact_id(id).is_err(),
                "expected '{}' to fail validation",
                id
            );
        }
        assert!(validate_contact_id("elena-rostova").is_ok());
        assert!(validate_contact_id("team_42").is_ok());
    }

    #[test]
    fn slugify_generates_valid_ids() {
        assert_eq!(slugify("Elena Rostova (VP)"), "elena-rostova-vp");
        assert_eq!(slugify("  Dr. Jean-Luc Picard!  "), "dr-jean-luc-picard");
        assert_eq!(slugify("///"), "contact");
        assert!(validate_contact_id(&slugify("Elena Rostova")).is_ok());
    }

    #[test]
    fn collects_diagnostics_for_malformed_timeline_and_stage() {
        let raw = "---\nid: test-lead\nname: Test Lead\nstage: spaceship\ndeal_value: 5000\n---\n\n## Timeline\n- malformed line without pipes\n";
        let parsed = parse_contact_markdown(raw, "test-lead", "contacts/test-lead.md").unwrap();
        assert_eq!(parsed.contact.stage, PipelineStage::Lead);
        assert_eq!(parsed.diagnostics.len(), 2);
    }
}
