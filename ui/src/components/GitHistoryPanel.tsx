import { useEffect, useState } from "react";
import type { GitCommitEntry, VaultSnapshot } from "../types";

interface GitHistoryPanelProps {
  snapshot: VaultSnapshot;
  selectedId: string | null;
  onSelectContact: (id: string) => void;
  onCommit: (message: string) => Promise<void>;
  loadHistory: (id: string) => Promise<GitCommitEntry[]>;
  showRevision: (id: string, rev: string) => Promise<string>;
  onRestoreRevision: (id: string, rev: string) => Promise<void>;
}

export function GitHistoryPanel({
  snapshot,
  selectedId,
  onSelectContact,
  onCommit,
  loadHistory,
  showRevision,
  onRestoreRevision,
}: GitHistoryPanelProps) {
  const activeId = selectedId ?? snapshot.contacts[0]?.id ?? null;
  const [commitMessage, setCommitMessage] = useState("");
  const [history, setHistory] = useState<GitCommitEntry[]>([]);
  const [inspectedRev, setInspectedRev] = useState<string | null>(null);
  const [revisionPreview, setRevisionPreview] = useState<string>("");

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setInspectedRev(null);
    setRevisionPreview("");
    void loadHistory(activeId).then((entries) => {
      if (!cancelled) setHistory(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId, snapshot.git_status.head_hash, snapshot.fingerprint, loadHistory]);

  async function handleCommitSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!commitMessage.trim()) return;
    await onCommit(commitMessage.trim());
    setCommitMessage("");
  }

  async function handleInspect(rev: string) {
    if (!activeId) return;
    const content = await showRevision(activeId, rev);
    setInspectedRev(rev);
    setRevisionPreview(content);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="panel">
        <div className="panel-header">
          <div>
            <span className="panel-title">Local Git Working Tree</span>
            <span className="cell-secondary mono" style={{ marginLeft: 10 }}>
              branch: {snapshot.git_status.branch} | HEAD:{" "}
              {snapshot.git_status.head_hash ?? "none"}
            </span>
          </div>
          <span
            className={`pill mono ${
              snapshot.git_status.clean ? "pill-pass" : "pill-warn"
            }`}
          >
            {snapshot.git_status.clean
              ? "clean working tree"
              : `${snapshot.git_status.modified_files.length} pending change(s)`}
          </span>
        </div>

        <div className="detail-body">
          {snapshot.git_status.modified_files.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {snapshot.git_status.modified_files.map((item) => (
                <div
                  key={item.path}
                  className="mono"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12.5,
                  }}
                >
                  <span className="pill pill-warn">{item.status}</span>
                  <span>{item.path}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="cell-secondary">
              Every plain-text Markdown file in contacts/ matches HEAD.
            </div>
          )}

          <form className="inline-form" onSubmit={handleCommitSubmit}>
            <input
              type="text"
              className="input mono"
              style={{ flex: 1 }}
              placeholder="Semantic commit message (e.g. deal(elena-rostova): move stage to won)"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={snapshot.git_status.clean || !commitMessage.trim()}
            >
              Commit Vault
            </button>
          </form>
        </div>
      </div>

      <div className="git-layout">
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Per-Contact Git Time-Travel</span>
            {activeId && (
              <select
                className="select mono"
                style={{ padding: "3px 8px", fontSize: 12 }}
                value={activeId}
                onChange={(e) => onSelectContact(e.target.value)}
              >
                {snapshot.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    contacts/{c.id}.md
                  </option>
                ))}
              </select>
            )}
          </div>

          {history.length === 0 ? (
            <div className="empty-state">
              No Git commit history recorded yet for this file.
            </div>
          ) : (
            <div className="detail-body">
              {history.map((commit) => (
                <div key={commit.hash} className="timeline-item">
                  <div className="timeline-head mono">
                    <span>
                      {commit.short_hash} — {commit.author}
                    </span>
                    <span>{commit.date.slice(0, 10)}</span>
                  </div>
                  <div style={{ marginBottom: 8 }}>{commit.message}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void handleInspect(commit.short_hash)}
                    >
                      Inspect Snapshot
                    </button>
                    {activeId && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void onRestoreRevision(activeId, commit.short_hash)}
                      >
                        Restore Revision
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">
              {inspectedRev
                ? `Snapshot @ ${inspectedRev}`
                : "Revision Markdown Preview"}
            </span>
            {inspectedRev && activeId && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void onRestoreRevision(activeId, inspectedRev)}
              >
                1-Click Rollback
              </button>
            )}
          </div>
          {revisionPreview ? (
            <pre className="code-preview mono">{revisionPreview}</pre>
          ) : (
            <div className="empty-state">
              Select Inspect Snapshot on any commit to view the exact Markdown file at that point in time.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
