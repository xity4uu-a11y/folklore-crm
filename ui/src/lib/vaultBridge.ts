import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Contact,
  GitCommitEntry,
  GitCommitResult,
  GitFileChange,
  GitVaultStatus,
  PluginManifest,
  VaultSnapshot,
} from "../types";
import {
  exportContactsCsv,
  exportContactsVcard,
  parseContactMarkdown,
  serializeContact,
  validateContactId,
} from "./markdown";
import { computeVaultSummary, todayIsoDate } from "./pipeline";
import { SEED_CONTACTS, SEED_PLUGINS } from "./seedVault";

interface BrowserCommitRecord {
  entry: GitCommitEntry;
  files: Record<string, string>;
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

function simpleHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function computeBrowserFingerprint(files: Record<string, string>): string {
  const keys = Object.keys(files).sort();
  const payload = keys.map((k) => `${k}\0${files[k]}`).join("\xff");
  return `${simpleHash(payload)}${simpleHash(payload + ":v1")}`;
}

class BrowserVaultSimulator {
  private vaultPath = "~/folklore-vault";
  private files: Record<string, string> = {};
  private committedFiles: Record<string, string> = {};
  private commits: BrowserCommitRecord[] = [];
  private plugins: PluginManifest[] = structuredClone(SEED_PLUGINS);
  private listeners: Array<() => void> = [];

  constructor() {
    const initialFiles: Record<string, string> = {};
    for (const c of SEED_CONTACTS) {
      initialFiles[c.id] = serializeContact(c);
    }

    // Seed two realistic Git commits so time-travel inspection & rollback works immediately
    const earlyFiles = { ...initialFiles };
    const elenaEarly = structuredClone(SEED_CONTACTS[0]);
    elenaEarly.stage = "qualified";
    elenaEarly.deal_value = 18000;
    earlyFiles["elena-rostova"] = serializeContact(elenaEarly);

    this.commits = [
      {
        entry: {
          hash: "9f4c2a1b8e7d6c5a4b3c2d1e0f9a8b7c6d5e4f3a",
          short_hash: "9f4c2a1",
          author: "xity4uu-a11y",
          date: "2026-11-22T16:40:00Z",
          message: "deal(elena-rostova): advance to proposal ($24,000) after SOC2 call",
        },
        files: { ...initialFiles },
      },
      {
        entry: {
          hash: "3a81e70d1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a69",
          short_hash: "3a81e70",
          author: "xity4uu-a11y",
          date: "2026-11-10T09:15:00Z",
          message: "chore(vault): initialize folklore crm vault with starter accounts",
        },
        files: { ...earlyFiles },
      },
    ];

    this.files = { ...initialFiles };
    this.committedFiles = { ...initialFiles };
  }

  private modifiedFiles(): GitFileChange[] {
    const changes: GitFileChange[] = [];
    const allIds = new Set([
      ...Object.keys(this.files),
      ...Object.keys(this.committedFiles),
    ]);
    for (const id of Array.from(allIds).sort()) {
      const cur = this.files[id];
      const prev = this.committedFiles[id];
      if (cur === undefined && prev !== undefined) {
        changes.push({ status: "D", path: `contacts/${id}.md` });
      } else if (cur !== undefined && prev === undefined) {
        changes.push({ status: "??", path: `contacts/${id}.md` });
      } else if (cur !== prev) {
        changes.push({ status: "M", path: `contacts/${id}.md` });
      }
    }
    return changes;
  }

  private buildGitStatus(): GitVaultStatus {
    const modified = this.modifiedFiles();
    return {
      is_repo: true,
      branch: "main",
      head_hash: this.commits[0]?.entry.short_hash ?? null,
      clean: modified.length === 0,
      modified_files: modified,
      has_remote: false,
      remote_url: null,
    };
  }

  loadVault(): VaultSnapshot {
    const contacts: Contact[] = [];
    const diagnostics = [];
    for (const id of Object.keys(this.files).sort()) {
      const parsed = parseContactMarkdown(
        this.files[id],
        id,
        `contacts/${id}.md`,
      );
      contacts.push(parsed.contact);
      diagnostics.push(...parsed.diagnostics);
    }
    contacts.sort((a, b) => a.name.localeCompare(b.name));
    return {
      vault_path: this.vaultPath,
      contacts,
      diagnostics,
      summary: computeVaultSummary(contacts),
      git_status: this.buildGitStatus(),
      fingerprint: computeBrowserFingerprint(this.files),
    };
  }

  openVault(path: string): VaultSnapshot {
    if (path.trim()) this.vaultPath = path.trim();
    return this.loadVault();
  }

  getRawMarkdown(id: string): string {
    validateContactId(id);
    if (!(id in this.files)) {
      throw new Error(`Contact '${id}' not found.`);
    }
    return this.files[id];
  }

  saveContact(contact: Contact): VaultSnapshot {
    validateContactId(contact.id);
    const normalized: Contact = {
      ...contact,
      file_path: `contacts/${contact.id}.md`,
    };
    this.files[contact.id] = serializeContact(normalized);
    return this.loadVault();
  }

  saveRawMarkdown(id: string, raw: string): VaultSnapshot {
    validateContactId(id);
    const parsed = parseContactMarkdown(raw, id, `contacts/${id}.md`);
    if (parsed.contact.id !== id) {
      throw new Error(`Frontmatter id '${parsed.contact.id}' must match '${id}'.`);
    }
    this.files[id] = raw.replace(/\r\n/g, "\n");
    return this.loadVault();
  }

  appendInteraction(id: string, date: string, kind: string, note: string): VaultSnapshot {
    const raw = this.getRawMarkdown(id);
    const { contact } = parseContactMarkdown(raw, id, `contacts/${id}.md`);
    contact.timeline.unshift({
      date: date.trim() || todayIsoDate(),
      kind: kind.trim().toLowerCase() || "note",
      note: note.trim(),
    });
    return this.saveContact(contact);
  }

  toggleTask(id: string, taskIndex: number): VaultSnapshot {
    const raw = this.getRawMarkdown(id);
    const { contact } = parseContactMarkdown(raw, id, `contacts/${id}.md`);
    if (taskIndex < 0 || taskIndex >= contact.tasks.length) {
      throw new Error(`Task index ${taskIndex} out of range.`);
    }
    contact.tasks[taskIndex].done = !contact.tasks[taskIndex].done;
    return this.saveContact(contact);
  }

  deleteContact(id: string): VaultSnapshot {
    validateContactId(id);
    delete this.files[id];
    return this.loadVault();
  }

  gitStatus(): GitVaultStatus {
    return this.buildGitStatus();
  }

  gitCommit(message: string): GitCommitResult {
    const trimmed = message.trim();
    if (!trimmed) throw new Error("Commit message cannot be empty.");
    const modified = this.modifiedFiles();
    if (modified.length === 0) {
      return {
        committed: false,
        commit_hash: this.commits[0]?.entry.short_hash ?? null,
        message: "Working tree clean; nothing to commit.",
      };
    }
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const hashSeed = `${now}:${trimmed}:${Object.keys(this.files).length}`;
    const fullHash = `${simpleHash(hashSeed)}${simpleHash(hashSeed + "a")}${simpleHash(hashSeed + "b")}${simpleHash(hashSeed + "c")}${simpleHash(hashSeed + "d")}`;
    const shortHash = fullHash.slice(0, 7);
    this.commits.unshift({
      entry: {
        hash: fullHash,
        short_hash: shortHash,
        author: "xity4uu-a11y",
        date: now,
        message: trimmed,
      },
      files: { ...this.files },
    });
    this.committedFiles = { ...this.files };
    return {
      committed: true,
      commit_hash: shortHash,
      message: trimmed,
    };
  }

  gitHistory(id: string): GitCommitEntry[] {
    validateContactId(id);
    const results: GitCommitEntry[] = [];
    for (let i = 0; i < this.commits.length; i += 1) {
      const cur = this.commits[i].files[id];
      const older = this.commits[i + 1]?.files[id];
      if (cur !== undefined && cur !== older) {
        results.push(this.commits[i].entry);
      }
    }
    return results;
  }

  gitShowRevision(id: string, rev: string): string {
    validateContactId(id);
    const record = this.commits.find(
      (c) => c.entry.hash === rev || c.entry.short_hash === rev,
    );
    if (!record || !(id in record.files)) {
      throw new Error(`Revision '${rev}' not found for contacts/${id}.md`);
    }
    return record.files[id];
  }

  gitRestore(id: string, rev: string): VaultSnapshot {
    const content = this.gitShowRevision(id, rev);
    this.files[id] = content;
    return this.loadVault();
  }

  exportCsv(): string {
    return exportContactsCsv(this.loadVault().contacts);
  }

  exportVcf(): string {
    return exportContactsVcard(this.loadVault().contacts);
  }

  listPlugins(): PluginManifest[] {
    return this.plugins.map((p) => ({ ...p }));
  }

  togglePlugin(id: string): PluginManifest[] {
    this.plugins = this.plugins.map((p) =>
      p.id === id ? { ...p, enabled: !p.enabled } : p,
    );
    return this.listPlugins();
  }

  subscribe(callback: () => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== callback);
    };
  }
}

const simulator = new BrowserVaultSimulator();

export const vaultBridge = {
  isDesktop: (): boolean => isTauriRuntime(),

  async openVault(path: string, initialize = false): Promise<VaultSnapshot> {
    if (isTauriRuntime()) {
      return invoke<VaultSnapshot>("open_vault", { path, initialize });
    }
    return simulator.openVault(path);
  },

  async loadVault(): Promise<VaultSnapshot> {
    if (isTauriRuntime()) {
      return invoke<VaultSnapshot>("load_vault");
    }
    return simulator.loadVault();
  },

  async getRawMarkdown(id: string): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("get_raw_markdown", { id });
    }
    return simulator.getRawMarkdown(id);
  },

  async saveContact(contact: Contact): Promise<VaultSnapshot> {
    if (isTauriRuntime()) {
      return invoke<VaultSnapshot>("save_contact", { contact });
    }
    return simulator.saveContact(contact);
  },

  async saveRawMarkdown(id: string, raw: string): Promise<VaultSnapshot> {
    if (isTauriRuntime()) {
      return invoke<VaultSnapshot>("save_raw_markdown", { id, raw });
    }
    return simulator.saveRawMarkdown(id, raw);
  },

  async appendInteraction(
    id: string,
    date: string,
    kind: string,
    note: string,
  ): Promise<VaultSnapshot> {
    if (isTauriRuntime()) {
      return invoke<VaultSnapshot>("append_interaction", { id, date, kind, note });
    }
    return simulator.appendInteraction(id, date, kind, note);
  },

  async toggleTask(id: string, taskIndex: number): Promise<VaultSnapshot> {
    if (isTauriRuntime()) {
      return invoke<VaultSnapshot>("toggle_task", { id, taskIndex });
    }
    return simulator.toggleTask(id, taskIndex);
  },

  async deleteContact(id: string): Promise<VaultSnapshot> {
    if (isTauriRuntime()) {
      return invoke<VaultSnapshot>("delete_contact", { id });
    }
    return simulator.deleteContact(id);
  },

  async gitStatus(): Promise<GitVaultStatus> {
    if (isTauriRuntime()) {
      return invoke<GitVaultStatus>("git_status");
    }
    return simulator.gitStatus();
  },

  async gitCommit(message: string): Promise<GitCommitResult> {
    if (isTauriRuntime()) {
      return invoke<GitCommitResult>("git_commit", { message });
    }
    return simulator.gitCommit(message);
  },

  async gitHistory(id: string, limit = 25): Promise<GitCommitEntry[]> {
    if (isTauriRuntime()) {
      return invoke<GitCommitEntry[]>("git_history", { id, limit });
    }
    return simulator.gitHistory(id);
  },

  async gitShowRevision(id: string, rev: string): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("git_show_revision", { id, rev });
    }
    return simulator.gitShowRevision(id, rev);
  },

  async gitRestore(id: string, rev: string): Promise<VaultSnapshot> {
    if (isTauriRuntime()) {
      return invoke<VaultSnapshot>("git_restore", { id, rev });
    }
    return simulator.gitRestore(id, rev);
  },

  async exportCsv(): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("export_csv");
    }
    return simulator.exportCsv();
  },

  async exportVcf(): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("export_vcf");
    }
    return simulator.exportVcf();
  },

  async listPlugins(): Promise<PluginManifest[]> {
    if (isTauriRuntime()) {
      return invoke<PluginManifest[]>("list_plugins");
    }
    return simulator.listPlugins();
  },

  toggleBrowserPlugin(id: string): PluginManifest[] {
    return simulator.togglePlugin(id);
  },

  async subscribeExternalSync(onSynced: () => void): Promise<() => void> {
    if (isTauriRuntime()) {
      const unlisten = await listen("vault-synced", () => {
        onSynced();
      });
      return unlisten;
    }
    return simulator.subscribe(onSynced);
  },
};
