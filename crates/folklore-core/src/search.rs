use crate::models::{Contact, PipelineStage};

#[derive(Debug, Clone, Default)]
pub struct SearchFilter {
    pub query: Option<String>,
    pub stage: Option<PipelineStage>,
    pub tag: Option<String>,
    pub owner: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SearchHit<'a> {
    pub contact: &'a Contact,
    pub score: u32,
}

/// Performs multi-field full-text search and filtering over contacts with deterministic relevance ranking.
pub fn search_contacts<'a>(contacts: &'a [Contact], filter: &SearchFilter) -> Vec<SearchHit<'a>> {
    let tokens: Vec<String> = filter
        .query
        .as_deref()
        .unwrap_or("")
        .split_whitespace()
        .map(|t| t.to_ascii_lowercase())
        .filter(|t| !t.is_empty())
        .collect();

    let stage_filter = filter.stage;
    let tag_filter = filter
        .tag
        .as_deref()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty());
    let owner_filter = filter
        .owner
        .as_deref()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty());

    let mut hits = Vec::new();

    for contact in contacts {
        if let Some(stage) = stage_filter {
            if contact.stage != stage {
                continue;
            }
        }
        if let Some(ref tag) = tag_filter {
            if !contact
                .tags
                .iter()
                .any(|t| t.to_ascii_lowercase() == *tag)
            {
                continue;
            }
        }
        if let Some(ref owner) = owner_filter {
            if contact.owner.to_ascii_lowercase() != *owner {
                continue;
            }
        }

        if tokens.is_empty() {
            hits.push(SearchHit { contact, score: 1 });
            continue;
        }

        let name_l = contact.name.to_ascii_lowercase();
        let company_l = contact.company.to_ascii_lowercase();
        let email_l = contact.email.to_ascii_lowercase();
        let role_l = contact.role.to_ascii_lowercase();
        let id_l = contact.id.to_ascii_lowercase();
        let context_l = contact.context.to_ascii_lowercase();
        let tags_l: Vec<String> = contact
            .tags
            .iter()
            .map(|t| t.to_ascii_lowercase())
            .collect();
        let timeline_l: String = contact
            .timeline
            .iter()
            .map(|i| format!("{} {} {}", i.date, i.kind, i.note))
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase();
        let tasks_l: String = contact
            .tasks
            .iter()
            .map(|t| t.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase();

        let mut total_score = 0u32;
        let mut all_matched = true;

        for token in &tokens {
            let mut token_score = 0u32;
            if name_l.contains(token) {
                token_score += if name_l.starts_with(token) { 14 } else { 10 };
            }
            if company_l.contains(token) {
                token_score += 8;
            }
            if email_l.contains(token) {
                token_score += 7;
            }
            if tags_l.iter().any(|t| t.contains(token)) {
                token_score += 6;
            }
            if role_l.contains(token) {
                token_score += 5;
            }
            if id_l.contains(token) {
                token_score += 4;
            }
            if context_l.contains(token) {
                token_score += 3;
            }
            if timeline_l.contains(token) {
                token_score += 2;
            }
            if tasks_l.contains(token) {
                token_score += 2;
            }

            if token_score == 0 {
                all_matched = false;
                break;
            }
            total_score += token_score;
        }

        if all_matched {
            hits.push(SearchHit {
                contact,
                score: total_score,
            });
        }
    }

    hits.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| {
                b.contact
                    .deal_value
                    .partial_cmp(&a.contact.deal_value)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| {
                a.contact
                    .name
                    .to_lowercase()
                    .cmp(&b.contact.name.to_lowercase())
            })
    });

    hits
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Interaction, TaskItem};

    fn fixture_contacts() -> Vec<Contact> {
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
                next_followup: None,
                tags: vec!["enterprise".to_string(), "security".to_string()],
                owner: "founder".to_string(),
                website: String::new(),
                phone: String::new(),
                context: "Needs SOC2 audit log via Git.".to_string(),
                timeline: vec![Interaction {
                    date: "2026-11-20".to_string(),
                    kind: "call".to_string(),
                    note: "Discussed HubSpot migration".to_string(),
                }],
                tasks: vec![TaskItem {
                    done: false,
                    text: "Send contract".to_string(),
                }],
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
                next_followup: None,
                tags: vec!["inbound".to_string()],
                owner: "founder".to_string(),
                website: String::new(),
                phone: String::new(),
                context: "Migrating from Pipedrive.".to_string(),
                timeline: vec![],
                tasks: vec![],
                file_path: "contacts/marcus-chen.md".to_string(),
            },
        ]
    }

    #[test]
    fn multi_token_search_and_filters() {
        let contacts = fixture_contacts();

        let hits = search_contacts(
            &contacts,
            &SearchFilter {
                query: Some("elena hubspot".to_string()),
                ..Default::default()
            },
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].contact.id, "elena-rostova");

        let by_stage = search_contacts(
            &contacts,
            &SearchFilter {
                stage: Some(PipelineStage::Negotiation),
                ..Default::default()
            },
        );
        assert_eq!(by_stage.len(), 1);
        assert_eq!(by_stage[0].contact.id, "marcus-chen");

        let by_tag = search_contacts(
            &contacts,
            &SearchFilter {
                tag: Some("SECURITY".to_string()),
                ..Default::default()
            },
        );
        assert_eq!(by_tag.len(), 1);
        assert_eq!(by_tag[0].contact.id, "elena-rostova");
    }
}
