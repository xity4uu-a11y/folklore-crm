export type PipelineStage =
  | "lead"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "won"
  | "lost";

export interface Interaction {
  date: string;
  kind: string;
  note: string;
}

export interface TaskItem {
  done: boolean;
  text: string;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
  role: string;
  stage: PipelineStage;
  deal_value: number;
  currency: string;
  next_followup: string | null;
  tags: string[];
  owner: string;
  website: string;
  phone: string;
  context: string;
  timeline: Interaction[];
  tasks: TaskItem[];
  file_path: string;
}

export interface ParseDiagnostic {
  file: string;
  line: number | null;
  severity: "warning" | "error";
  message: string;
}

export interface StageSummary {
  stage: PipelineStage;
  count: number;
  total_value: number;
  weighted_value: number;
  probability: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface VaultSummary {
  total_contacts: number;
  open_deals: number;
  total_pipeline_value: number;
  weighted_pipeline_value: number;
  won_value: number;
  overdue_followups: string[];
  due_soon_followups: string[];
  stale_contacts: string[];
  open_tasks_count: number;
  stages: StageSummary[];
  tag_counts: TagCount[];
}

export interface GitCommitEntry {
  hash: string;
  short_hash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitFileChange {
  status: string;
  path: string;
}

export interface GitVaultStatus {
  is_repo: boolean;
  branch: string;
  head_hash: string | null;
  clean: boolean;
  modified_files: GitFileChange[];
  has_remote: boolean;
  remote_url: string | null;
}

export interface GitCommitResult {
  committed: boolean;
  commit_hash: string | null;
  message: string;
}

export interface VaultSnapshot {
  vault_path: string;
  contacts: Contact[];
  diagnostics: ParseDiagnostic[];
  summary: VaultSummary;
  git_status: GitVaultStatus;
  fingerprint: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  kind: string;
  description: string;
  author: string;
  enabled: boolean;
  config: Record<string, unknown>;
  source_file?: string | null;
}

export type ActiveView =
  | "contacts"
  | "pipeline"
  | "radar"
  | "editor"
  | "git"
  | "plugins";
