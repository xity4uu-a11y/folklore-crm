use folklore_core::git_sync::{
    commit_all, file_history, init_vault, pull_remote, push_remote, restore_revision,
    show_revision, vault_fingerprint, vault_status,
};
use folklore_core::markdown::validate_contact_id;
use folklore_core::models::{
    Contact, GitCommitEntry, GitCommitResult, GitVaultStatus, PluginManifest, VaultSnapshot,
};
use folklore_core::plugins::load_plugins_from_dir;
use folklore_core::vault::{
    append_interaction as core_append_interaction, delete_contact as core_delete_contact,
    export_csv as core_export_csv, export_vcard as core_export_vcard,
    load_vault as core_load_vault, read_contact_raw, save_contact as core_save_contact,
    save_raw_markdown as core_save_raw_markdown, toggle_task as core_toggle_task,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

struct VaultState {
    vault_path: Arc<Mutex<PathBuf>>,
    last_fingerprint: Arc<Mutex<String>>,
}

#[derive(Debug, Clone, Serialize)]
struct VaultSyncedEvent {
    vault_path: String,
    fingerprint: String,
}

fn default_vault_dir() -> PathBuf {
    if let Ok(env_path) = std::env::var("FOLKLORE_VAULT") {
        if !env_path.trim().is_empty() {
            return PathBuf::from(env_path);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let example = cwd.join("examples").join("vault");
        if example.join("contacts").exists() {
            return example;
        }
        return cwd.join("folklore-vault");
    }
    PathBuf::from("./folklore-vault")
}

fn current_vault_path(state: &State<'_, VaultState>) -> Result<PathBuf, String> {
    state
        .vault_path
        .lock()
        .map(|guard| guard.clone())
        .map_err(|_| "vault state mutex poisoned".to_string())
}

fn update_fingerprint_cache(state: &State<'_, VaultState>, vault: &PathBuf) {
    if let Ok(fp) = vault_fingerprint(vault) {
        if let Ok(mut guard) = state.last_fingerprint.lock() {
            *guard = fp;
        }
    }
}

#[tauri::command]
fn open_vault(
    path: String,
    initialize: Option<bool>,
    state: State<'_, VaultState>,
) -> Result<VaultSnapshot, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("vault path cannot be empty".to_string());
    }
    let next_path = PathBuf::from(trimmed);
    if initialize.unwrap_or(false) || !next_path.join("contacts").exists() {
        init_vault(&next_path).map_err(|e| e.to_string())?;
    }
    {
        let mut guard = state
            .vault_path
            .lock()
            .map_err(|_| "vault state mutex poisoned".to_string())?;
        *guard = next_path.clone();
    }
    let snapshot = core_load_vault(&next_path).map_err(|e| e.to_string())?;
    if let Ok(mut fp_guard) = state.last_fingerprint.lock() {
        *fp_guard = snapshot.fingerprint.clone();
    }
    Ok(snapshot)
}

#[tauri::command]
fn load_vault(state: State<'_, VaultState>) -> Result<VaultSnapshot, String> {
    let vault = current_vault_path(&state)?;
    if !vault.join("contacts").exists() {
        init_vault(&vault).map_err(|e| e.to_string())?;
    }
    let snapshot = core_load_vault(&vault).map_err(|e| e.to_string())?;
    if let Ok(mut fp_guard) = state.last_fingerprint.lock() {
        *fp_guard = snapshot.fingerprint.clone();
    }
    Ok(snapshot)
}

#[tauri::command]
fn get_raw_markdown(id: String, state: State<'_, VaultState>) -> Result<String, String> {
    let vault = current_vault_path(&state)?;
    read_contact_raw(&vault, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_contact(contact: Contact, state: State<'_, VaultState>) -> Result<VaultSnapshot, String> {
    let vault = current_vault_path(&state)?;
    core_save_contact(&vault, &contact).map_err(|e| e.to_string())?;
    update_fingerprint_cache(&state, &vault);
    core_load_vault(&vault).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_raw_markdown(
    id: String,
    raw: String,
    state: State<'_, VaultState>,
) -> Result<VaultSnapshot, String> {
    let vault = current_vault_path(&state)?;
    core_save_raw_markdown(&vault, &id, &raw).map_err(|e| e.to_string())?;
    update_fingerprint_cache(&state, &vault);
    core_load_vault(&vault).map_err(|e| e.to_string())
}

#[tauri::command]
fn append_interaction(
    id: String,
    date: String,
    kind: String,
    note: String,
    state: State<'_, VaultState>,
) -> Result<VaultSnapshot, String> {
    let vault = current_vault_path(&state)?;
    core_append_interaction(&vault, &id, &date, &kind, &note).map_err(|e| e.to_string())?;
    update_fingerprint_cache(&state, &vault);
    core_load_vault(&vault).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_task(
    id: String,
    task_index: usize,
    state: State<'_, VaultState>,
) -> Result<VaultSnapshot, String> {
    let vault = current_vault_path(&state)?;
    core_toggle_task(&vault, &id, task_index).map_err(|e| e.to_string())?;
    update_fingerprint_cache(&state, &vault);
    core_load_vault(&vault).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_contact(id: String, state: State<'_, VaultState>) -> Result<VaultSnapshot, String> {
    let vault = current_vault_path(&state)?;
    core_delete_contact(&vault, &id).map_err(|e| e.to_string())?;
    update_fingerprint_cache(&state, &vault);
    core_load_vault(&vault).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_status(state: State<'_, VaultState>) -> Result<GitVaultStatus, String> {
    let vault = current_vault_path(&state)?;
    vault_status(&vault).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_commit(message: String, state: State<'_, VaultState>) -> Result<GitCommitResult, String> {
    let vault = current_vault_path(&state)?;
    commit_all(&vault, &message).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_history(
    id: String,
    limit: Option<usize>,
    state: State<'_, VaultState>,
) -> Result<Vec<GitCommitEntry>, String> {
    validate_contact_id(&id).map_err(|e| e.to_string())?;
    let vault = current_vault_path(&state)?;
    let rel_path = format!("contacts/{}.md", id);
    file_history(&vault, &rel_path, limit.unwrap_or(25)).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_show_revision(
    id: String,
    rev: String,
    state: State<'_, VaultState>,
) -> Result<String, String> {
    validate_contact_id(&id).map_err(|e| e.to_string())?;
    let vault = current_vault_path(&state)?;
    let rel_path = format!("contacts/{}.md", id);
    show_revision(&vault, &rev, &rel_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_restore(
    id: String,
    rev: String,
    state: State<'_, VaultState>,
) -> Result<VaultSnapshot, String> {
    validate_contact_id(&id).map_err(|e| e.to_string())?;
    let vault = current_vault_path(&state)?;
    let rel_path = format!("contacts/{}.md", id);
    restore_revision(&vault, &rev, &rel_path).map_err(|e| e.to_string())?;
    update_fingerprint_cache(&state, &vault);
    core_load_vault(&vault).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_pull(
    remote: String,
    branch: String,
    state: State<'_, VaultState>,
) -> Result<String, String> {
    let vault = current_vault_path(&state)?;
    pull_remote(&vault, &remote, &branch).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_push(
    remote: String,
    branch: String,
    state: State<'_, VaultState>,
) -> Result<String, String> {
    let vault = current_vault_path(&state)?;
    push_remote(&vault, &remote, &branch).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_csv(state: State<'_, VaultState>) -> Result<String, String> {
    let vault = current_vault_path(&state)?;
    let snapshot = core_load_vault(&vault).map_err(|e| e.to_string())?;
    Ok(core_export_csv(&snapshot.contacts))
}

#[tauri::command]
fn export_vcf(state: State<'_, VaultState>) -> Result<String, String> {
    let vault = current_vault_path(&state)?;
    let snapshot = core_load_vault(&vault).map_err(|e| e.to_string())?;
    Ok(core_export_vcard(&snapshot.contacts))
}

#[tauri::command]
fn list_plugins(state: State<'_, VaultState>) -> Result<Vec<PluginManifest>, String> {
    let vault = current_vault_path(&state)?;
    let vault_plugins = vault.join("plugins");
    let candidate = if vault_plugins.exists() {
        vault_plugins
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("plugins")
    };
    let (manifests, _) = load_plugins_from_dir(&candidate).map_err(|e| e.to_string())?;
    Ok(manifests)
}

fn spawn_vault_watcher(
    app: AppHandle,
    vault_path: Arc<Mutex<PathBuf>>,
    last_fingerprint: Arc<Mutex<String>>,
) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(1200));
        let path = match vault_path.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => continue,
        };
        let Ok(current_fp) = vault_fingerprint(&path) else {
            continue;
        };
        let changed = match last_fingerprint.lock() {
            Ok(mut guard) => {
                if *guard != current_fp {
                    *guard = current_fp.clone();
                    true
                } else {
                    false
                }
            }
            Err(_) => false,
        };
        if changed {
            let _ = app.emit(
                "vault-synced",
                VaultSyncedEvent {
                    vault_path: path.to_string_lossy().to_string(),
                    fingerprint: current_fp,
                },
            );
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_path = default_vault_dir();
    let initial_fp = vault_fingerprint(&initial_path).unwrap_or_default();
    let vault_state = VaultState {
        vault_path: Arc::new(Mutex::new(initial_path)),
        last_fingerprint: Arc::new(Mutex::new(initial_fp)),
    };

    tauri::Builder::default()
        .manage(vault_state)
        .setup(|app| {
            let state = app.state::<VaultState>();
            spawn_vault_watcher(
                app.handle().clone(),
                Arc::clone(&state.vault_path),
                Arc::clone(&state.last_fingerprint),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_vault,
            load_vault,
            get_raw_markdown,
            save_contact,
            save_raw_markdown,
            append_interaction,
            toggle_task,
            delete_contact,
            git_status,
            git_commit,
            git_history,
            git_show_revision,
            git_restore,
            git_pull,
            git_push,
            export_csv,
            export_vcf,
            list_plugins,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Folklore CRM desktop application");
}
