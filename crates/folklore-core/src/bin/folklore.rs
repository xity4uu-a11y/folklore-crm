use clap::{Args, Parser, Subcommand, ValueEnum};
use folklore_core::git_sync::{
    commit_all, file_history, init_vault, restore_revision, vault_status,
};
use folklore_core::markdown::{slugify, validate_contact_id};
use folklore_core::models::{Contact, PipelineStage};
use folklore_core::plugins::load_plugins_from_dir;
use folklore_core::search::{search_contacts, SearchFilter};
use folklore_core::vault::{
    append_interaction, export_csv, export_vcard, load_contact, load_vault, read_contact_raw,
    save_contact,
};
use folklore_core::VERSION;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::str::FromStr;

#[derive(Parser)]
#[command(
    name = "folklore",
    version = VERSION,
    about = "Folklore CRM — plain-text Markdown + local Git CRM CLI ($0/seat, zero cloud lock-in)"
)]
struct Cli {
    /// Path to the Folklore CRM vault directory (defaults to FOLKLORE_VAULT or current directory)
    #[arg(long, global = true, env = "FOLKLORE_VAULT")]
    vault: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Clone, ValueEnum)]
enum ExportFormat {
    Csv,
    Vcf,
}

#[derive(Args)]
struct AddArgs {
    #[arg(long)]
    id: Option<String>,
    #[arg(long)]
    name: String,
    #[arg(long, default_value = "")]
    email: String,
    #[arg(long, default_value = "")]
    company: String,
    #[arg(long, default_value = "")]
    role: String,
    #[arg(long, default_value = "lead")]
    stage: String,
    #[arg(long, default_value_t = 0.0)]
    value: f64,
    #[arg(long, default_value = "USD")]
    currency: String,
    #[arg(long)]
    followup: Option<String>,
    #[arg(long, default_value = "")]
    tags: String,
    #[arg(long, default_value = "founder")]
    owner: String,
    #[arg(long, default_value = "")]
    website: String,
    #[arg(long, default_value = "")]
    phone: String,
    #[arg(long, default_value = "")]
    context: String,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize a new Git-backed Folklore CRM vault directory
    Init {
        /// Directory to initialize (defaults to --vault or current directory)
        dir: Option<PathBuf>,
    },
    /// List contacts with optional stage, tag, or full-text query filters
    List {
        #[arg(long)]
        stage: Option<String>,
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        query: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Display a single contact profile or raw Markdown source
    Show {
        id: String,
        #[arg(long)]
        raw: bool,
        #[arg(long)]
        json: bool,
    },
    /// Add a new plain-text contact Markdown file to the vault
    Add(Box<AddArgs>),
    /// Append a timestamped interaction to a contact's ## Timeline section
    Log {
        id: String,
        #[arg(long, default_value = "note")]
        kind: String,
        #[arg(long)]
        note: String,
        #[arg(long, default_value = "")]
        date: String,
    },
    /// Show weighted pipeline metrics, overdue follow-ups, and stale relationship radar
    Pipeline {
        #[arg(long)]
        json: bool,
    },
    /// Show local Git repository status for the CRM vault
    Status {
        #[arg(long)]
        json: bool,
    },
    /// Commit pending plain-text Markdown contact changes to local Git
    Commit {
        #[arg(short = 'm', long = "message")]
        message: String,
    },
    /// Show Git commit history for a specific contact file
    History {
        id: String,
        #[arg(long, default_value_t = 20)]
        limit: usize,
        #[arg(long)]
        json: bool,
    },
    /// Restore a contact file to a previous Git revision
    Restore {
        id: String,
        #[arg(long)]
        rev: String,
    },
    /// Export contacts to formula-safe CSV or RFC 6350 vCard (.vcf)
    Export {
        #[arg(long, value_enum)]
        format: ExportFormat,
        #[arg(short = 'o', long = "output")]
        output: Option<PathBuf>,
    },
    /// Validate Folklore community plugin JSON manifests
    ValidatePlugins {
        #[arg(long, default_value = "plugins")]
        dir: PathBuf,
    },
    /// Print Folklore CRM CLI version
    Version,
}

fn resolve_vault(vault_arg: Option<PathBuf>) -> PathBuf {
    vault_arg.unwrap_or_else(|| PathBuf::from("."))
}

fn run(cli: Cli) -> folklore_core::Result<()> {
    match cli.command {
        Commands::Init { dir } => {
            let target = dir.unwrap_or_else(|| resolve_vault(cli.vault));
            let status = init_vault(&target)?;
            println!("Initialized Folklore CRM vault at {}", target.display());
            println!(
                "Git branch: {} | HEAD: {} | Clean: {}",
                status.branch,
                status.head_hash.as_deref().unwrap_or("none"),
                status.clean
            );
        }
        Commands::List {
            stage,
            tag,
            query,
            json,
        } => {
            let vault_dir = resolve_vault(cli.vault);
            let snapshot = load_vault(&vault_dir)?;
            let parsed_stage = match stage {
                Some(raw) => Some(
                    PipelineStage::from_str(&raw)
                        .map_err(folklore_core::FolkloreError::Validation)?,
                ),
                None => None,
            };
            let hits = search_contacts(
                &snapshot.contacts,
                &SearchFilter {
                    query,
                    stage: parsed_stage,
                    tag,
                    owner: None,
                },
            );
            if json {
                let items: Vec<&Contact> = hits.iter().map(|h| h.contact).collect();
                println!(
                    "{}",
                    serde_json::to_string_pretty(&items).unwrap_or_else(|_| "[]".to_string())
                );
            } else {
                println!(
                    "{:<22} {:<20} {:<18} {:<12} {:>10} {:<12}",
                    "ID", "NAME", "COMPANY", "STAGE", "VALUE", "FOLLOW-UP"
                );
                println!("{}", "-".repeat(98));
                for hit in hits {
                    let c = hit.contact;
                    println!(
                        "{:<22} {:<20} {:<18} {:<12} {:>10.0} {:<12}",
                        truncate(&c.id, 21),
                        truncate(&c.name, 19),
                        truncate(&c.company, 17),
                        c.stage.as_str(),
                        c.deal_value,
                        c.next_followup.as_deref().unwrap_or("-")
                    );
                }
            }
        }
        Commands::Show { id, raw, json } => {
            let vault_dir = resolve_vault(cli.vault);
            if raw {
                let content = read_contact_raw(&vault_dir, &id)?;
                print!("{}", content);
            } else {
                let contact = load_contact(&vault_dir, &id)?;
                if json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&contact)
                            .unwrap_or_else(|_| "{}".to_string())
                    );
                } else {
                    println!("{} ({})", contact.name, contact.id);
                    println!("Company:   {} | Role: {}", contact.company, contact.role);
                    println!("Email:     {} | Phone: {}", contact.email, contact.phone);
                    println!(
                        "Stage:     {} | Deal: {} {:.0}",
                        contact.stage.as_str(),
                        contact.currency,
                        contact.deal_value
                    );
                    println!(
                        "Follow-up: {} | Tags: {}",
                        contact.next_followup.as_deref().unwrap_or("none"),
                        contact.tags.join(", ")
                    );
                    if !contact.context.is_empty() {
                        println!("\nContext:\n{}", contact.context);
                    }
                    if !contact.timeline.is_empty() {
                        println!("\nTimeline:");
                        for item in &contact.timeline {
                            println!("  - {} | {} | {}", item.date, item.kind, item.note);
                        }
                    }
                    if !contact.tasks.is_empty() {
                        println!("\nTasks:");
                        for task in &contact.tasks {
                            println!("  - [{}] {}", if task.done { "x" } else { " " }, task.text);
                        }
                    }
                }
            }
        }
        Commands::Add(args) => {
            let AddArgs {
                id,
                name,
                email,
                company,
                role,
                stage,
                value,
                currency,
                followup,
                tags,
                owner,
                website,
                phone,
                context,
            } = *args;
            let vault_dir = resolve_vault(cli.vault);
            let contact_id = id.unwrap_or_else(|| slugify(&name));
            validate_contact_id(&contact_id)?;
            let parsed_stage = PipelineStage::from_str(&stage)
                .map_err(folklore_core::FolkloreError::Validation)?;
            let parsed_tags: Vec<String> = tags
                .split(',')
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect();

            let contact = Contact {
                id: contact_id.clone(),
                name,
                email,
                company,
                role,
                stage: parsed_stage,
                deal_value: value.max(0.0),
                currency: currency.to_ascii_uppercase(),
                next_followup: followup.filter(|f| !f.trim().is_empty()),
                tags: parsed_tags,
                owner,
                website,
                phone,
                context,
                timeline: Vec::new(),
                tasks: Vec::new(),
                file_path: format!("contacts/{}.md", contact_id),
            };
            let saved = save_contact(&vault_dir, &contact)?;
            println!("Saved contact '{}' at {}", saved.id, saved.file_path);
        }
        Commands::Log {
            id,
            kind,
            note,
            date,
        } => {
            let vault_dir = resolve_vault(cli.vault);
            let updated = append_interaction(&vault_dir, &id, &date, &kind, &note)?;
            println!(
                "Logged {} interaction for {} (total timeline entries: {})",
                kind,
                updated.id,
                updated.timeline.len()
            );
        }
        Commands::Pipeline { json } => {
            let vault_dir = resolve_vault(cli.vault);
            let snapshot = load_vault(&vault_dir)?;
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&snapshot.summary)
                        .unwrap_or_else(|_| "{}".to_string())
                );
            } else {
                let s = &snapshot.summary;
                println!("Folklore CRM Pipeline Summary");
                println!("Contacts: {} | Open deals: {}", s.total_contacts, s.open_deals);
                println!(
                    "Open pipeline: ${:.0} | Weighted forecast: ${:.0} | Closed won: ${:.0}",
                    s.total_pipeline_value, s.weighted_pipeline_value, s.won_value
                );
                println!(
                    "Overdue follow-ups: {} | Stale (>14d): {} | Open tasks: {}",
                    s.overdue_followups.len(),
                    s.stale_contacts.len(),
                    s.open_tasks_count
                );
                println!("\n{:<14} {:>6} {:>12} {:>12} {:>8}", "STAGE", "COUNT", "RAW", "WEIGHTED", "PROB");
                println!("{}", "-".repeat(56));
                for st in &s.stages {
                    println!(
                        "{:<14} {:>6} {:>12.0} {:>12.0} {:>7.0}%",
                        st.stage.label(),
                        st.count,
                        st.total_value,
                        st.weighted_value,
                        st.probability * 100.0
                    );
                }
            }
        }
        Commands::Status { json } => {
            let vault_dir = resolve_vault(cli.vault);
            let status = vault_status(&vault_dir)?;
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&status).unwrap_or_else(|_| "{}".to_string())
                );
            } else {
                println!("Git repo:  {}", status.is_repo);
                println!("Branch:    {}", status.branch);
                println!("HEAD:      {}", status.head_hash.as_deref().unwrap_or("none"));
                println!("Clean:     {}", status.clean);
                if !status.modified_files.is_empty() {
                    println!("Modified files:");
                    for f in &status.modified_files {
                        println!("  [{}] {}", f.status, f.path);
                    }
                }
            }
        }
        Commands::Commit { message } => {
            let vault_dir = resolve_vault(cli.vault);
            let result = commit_all(&vault_dir, &message)?;
            if result.committed {
                println!(
                    "Committed {} — {}",
                    result.commit_hash.as_deref().unwrap_or("HEAD"),
                    result.message
                );
            } else {
                println!("{}", result.message);
            }
        }
        Commands::History { id, limit, json } => {
            let vault_dir = resolve_vault(cli.vault);
            validate_contact_id(&id)?;
            let rel_path = format!("contacts/{}.md", id);
            let entries = file_history(&vault_dir, &rel_path, limit)?;
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&entries).unwrap_or_else(|_| "[]".to_string())
                );
            } else if entries.is_empty() {
                println!("No Git history found for {}", rel_path);
            } else {
                for e in entries {
                    println!("{}  {}  {}  {}", e.short_hash, e.date, e.author, e.message);
                }
            }
        }
        Commands::Restore { id, rev } => {
            let vault_dir = resolve_vault(cli.vault);
            validate_contact_id(&id)?;
            let rel_path = format!("contacts/{}.md", id);
            let _ = restore_revision(&vault_dir, &rev, &rel_path)?;
            println!("Restored {} to revision {}", rel_path, rev);
        }
        Commands::Export { format, output } => {
            let vault_dir = resolve_vault(cli.vault);
            let snapshot = load_vault(&vault_dir)?;
            let rendered = match format {
                ExportFormat::Csv => export_csv(&snapshot.contacts),
                ExportFormat::Vcf => export_vcard(&snapshot.contacts),
            };
            match output {
                Some(path) => {
                    fs::write(&path, rendered)?;
                    println!(
                        "Exported {} contacts to {}",
                        snapshot.contacts.len(),
                        path.display()
                    );
                }
                None => {
                    print!("{}", rendered);
                }
            }
        }
        Commands::ValidatePlugins { dir } => {
            let resolved_dir = if dir.is_relative() {
                let candidate = Path::new(&dir);
                if candidate.exists() {
                    dir
                } else {
                    resolve_vault(cli.vault).join(dir)
                }
            } else {
                dir
            };
            let (manifests, report) = load_plugins_from_dir(&resolved_dir)?;
            for m in &manifests {
                println!("PASS  {}  v{}  [{}]", m.id, m.version, m.kind);
            }
            for err in &report.errors {
                eprintln!("FAIL  {}", err);
            }
            println!(
                "Validated plugins in {}: {}/{} passed",
                resolved_dir.display(),
                report.valid,
                report.valid + report.invalid
            );
            if report.invalid > 0 {
                return Err(folklore_core::FolkloreError::Validation(format!(
                    "{} plugin manifest(s) failed validation",
                    report.invalid
                )));
            }
        }
        Commands::Version => {
            println!("folklore {}", VERSION);
        }
    }
    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
        out.push('~');
        out
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {}", err);
            ExitCode::FAILURE
        }
    }
}
