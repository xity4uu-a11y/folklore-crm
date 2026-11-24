use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PipelineStage {
    Lead,
    Qualified,
    Proposal,
    Negotiation,
    Won,
    Lost,
}

impl PipelineStage {
    pub const ALL: [PipelineStage; 6] = [
        PipelineStage::Lead,
        PipelineStage::Qualified,
        PipelineStage::Proposal,
        PipelineStage::Negotiation,
        PipelineStage::Won,
        PipelineStage::Lost,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            PipelineStage::Lead => "lead",
            PipelineStage::Qualified => "qualified",
            PipelineStage::Proposal => "proposal",
            PipelineStage::Negotiation => "negotiation",
            PipelineStage::Won => "won",
            PipelineStage::Lost => "lost",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            PipelineStage::Lead => "Lead",
            PipelineStage::Qualified => "Qualified",
            PipelineStage::Proposal => "Proposal",
            PipelineStage::Negotiation => "Negotiation",
            PipelineStage::Won => "Won",
            PipelineStage::Lost => "Lost",
        }
    }

    pub fn probability(&self) -> f64 {
        match self {
            PipelineStage::Lead => 0.15,
            PipelineStage::Qualified => 0.35,
            PipelineStage::Proposal => 0.60,
            PipelineStage::Negotiation => 0.80,
            PipelineStage::Won => 1.00,
            PipelineStage::Lost => 0.00,
        }
    }

    pub fn is_open(&self) -> bool {
        !matches!(self, PipelineStage::Won | PipelineStage::Lost)
    }
}

impl fmt::Display for PipelineStage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for PipelineStage {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "lead" => Ok(PipelineStage::Lead),
            "qualified" => Ok(PipelineStage::Qualified),
            "proposal" => Ok(PipelineStage::Proposal),
            "negotiation" => Ok(PipelineStage::Negotiation),
            "won" => Ok(PipelineStage::Won),
            "lost" => Ok(PipelineStage::Lost),
            other => Err(format!(
                "unknown pipeline stage '{}'; expected one of: lead, qualified, proposal, negotiation, won, lost",
                other
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Interaction {
    pub date: String,
    pub kind: String,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskItem {
    pub done: bool,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Contact {
    pub id: String,
    pub name: String,
    pub email: String,
    pub company: String,
    pub role: String,
    pub stage: PipelineStage,
    pub deal_value: f64,
    pub currency: String,
    pub next_followup: Option<String>,
    pub tags: Vec<String>,
    pub owner: String,
    pub website: String,
    pub phone: String,
    pub context: String,
    pub timeline: Vec<Interaction>,
    pub tasks: Vec<TaskItem>,
    pub file_path: String,
}

impl Contact {
    pub fn last_interaction_date(&self) -> Option<&str> {
        self.timeline
            .iter()
            .map(|item| item.date.as_str())
            .filter(|d| !d.is_empty())
            .max()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParseDiagnostic {
    pub file: String,
    pub line: Option<usize>,
    pub severity: DiagnosticSeverity,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageSummary {
    pub stage: PipelineStage,
    pub count: usize,
    pub total_value: f64,
    pub weighted_value: f64,
    pub probability: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultSummary {
    pub total_contacts: usize,
    pub open_deals: usize,
    pub total_pipeline_value: f64,
    pub weighted_pipeline_value: f64,
    pub won_value: f64,
    pub overdue_followups: Vec<String>,
    pub due_soon_followups: Vec<String>,
    pub stale_contacts: Vec<String>,
    pub open_tasks_count: usize,
    pub stages: Vec<StageSummary>,
    pub tag_counts: Vec<TagCount>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitCommitEntry {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitFileChange {
    pub status: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitVaultStatus {
    pub is_repo: bool,
    pub branch: String,
    pub head_hash: Option<String>,
    pub clean: bool,
    pub modified_files: Vec<GitFileChange>,
    pub has_remote: bool,
    pub remote_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitCommitResult {
    pub committed: bool,
    pub commit_hash: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultSnapshot {
    pub vault_path: String,
    pub contacts: Vec<Contact>,
    pub diagnostics: Vec<ParseDiagnostic>,
    pub summary: VaultSummary,
    pub git_status: GitVaultStatus,
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub kind: String,
    pub description: String,
    pub author: String,
    pub enabled: bool,
    pub config: serde_json::Value,
    #[serde(default)]
    pub source_file: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginValidationReport {
    pub valid: usize,
    pub invalid: usize,
    pub errors: Vec<String>,
}
