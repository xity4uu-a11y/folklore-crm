import { useEffect, useMemo, useState } from "react";
import type { VaultSnapshot } from "../types";
import { parseContactMarkdown } from "../lib/markdown";
import { STAGE_LABELS, formatCurrency } from "../lib/pipeline";

interface MarkdownSplitEditorProps {
  snapshot: VaultSnapshot;
  selectedId: string | null;
  onSelectContact: (id: string) => void;
  loadRawMarkdown: (id: string) => Promise<string>;
  onSaveRawMarkdown: (id: string, raw: string) => Promise<void>;
}

export function MarkdownSplitEditor({
  snapshot,
  selectedId,
  onSelectContact,
  loadRawMarkdown,
  onSaveRawMarkdown,
}: MarkdownSplitEditorProps) {
  const activeId = selectedId ?? snapshot.contacts[0]?.id ?? null;
  const [savedText, setSavedText] = useState("");
  const [draftText, setDraftText] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setLoading(true);
    void loadRawMarkdown(activeId)
      .then((text) => {
        if (!cancelled) {
          setSavedText(text);
          setDraftText(text);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, snapshot.fingerprint, loadRawMarkdown]);

  const liveParse = useMemo(() => {
    if (!activeId || !draftText) return { parsed: null, error: null as string | null };
    try {
      return {
        parsed: parseContactMarkdown(draftText, activeId, `contacts/${activeId}.md`),
        error: null,
      };
    } catch (err) {
      return {
        parsed: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [activeId, draftText]);

  const isDirty = draftText !== savedText;

  async function handleSave() {
    if (!activeId || liveParse.error) return;
    await onSaveRawMarkdown(activeId, draftText);
    setSavedText(draftText);
  }

  if (!activeId) {
    return <div className="panel empty-state">Create a contact to edit Markdown files.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="filter-bar" style={{ marginBottom: 0 }}>
        <select
          className="select mono"
          value={activeId}
          onChange={(e) => onSelectContact(e.target.value)}
          aria-label="Select contact Markdown file"
        >
          {snapshot.contacts.map((c) => (
            <option key={c.id} value={c.id}>
              contacts/{c.id}.md — {c.name}
            </option>
          ))}
        </select>

        <span className={`pill mono ${isDirty ? "pill-warn" : "pill-pass"}`}>
          {isDirty ? "unsaved edits" : "synced to disk"}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!isDirty}
            onClick={() => setDraftText(savedText)}
          >
            Revert
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!isDirty || Boolean(liveParse.error)}
            onClick={() => void handleSave()}
          >
            Save .md
          </button>
        </div>
      </div>

      <div className="split-editor">
        <div className="editor-pane">
          <div className="panel-header">
            <span className="panel-title mono">contacts/{activeId}.md</span>
            <span className="cell-secondary mono">
              {draftText.split("\n").length} lines | YAML + Markdown
            </span>
          </div>
          {loading ? (
            <div className="empty-state">Loading plain-text Markdown...</div>
          ) : (
            <textarea
              className="editor-textarea mono"
              spellCheck={false}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              aria-label="Raw Markdown editor"
            />
          )}
        </div>

        <div className="editor-pane" style={{ overflow: "auto" }}>
          <div className="panel-header">
            <span className="panel-title">Live Structured Preview</span>
            <span className="cell-secondary">Instant frontmatter parser</span>
          </div>
          {liveParse.error ? (
            <div className="detail-body">
              <div className="pill pill-fail" style={{ alignSelf: "flex-start" }}>
                Parse Error
              </div>
              <div className="context-box mono">{liveParse.error}</div>
            </div>
          ) : liveParse.parsed ? (
            <div className="detail-body">
              {liveParse.parsed.diagnostics.length > 0 && (
                <div className="context-box">
                  {liveParse.parsed.diagnostics.map((d, idx) => (
                    <div key={idx} className="mono" style={{ fontSize: 12 }}>
                      [warn] line {d.line ?? "-"}: {d.message}
                    </div>
                  ))}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: 17, fontWeight: 650 }}>
                    {liveParse.parsed.contact.name}
                  </div>
                  <div className="cell-secondary">
                    {liveParse.parsed.contact.company}
                    {liveParse.parsed.contact.role
                      ? ` — ${liveParse.parsed.contact.role}`
                      : ""}
                  </div>
                </div>
                <span className={`pill pill-stage-${liveParse.parsed.contact.stage}`}>
                  {STAGE_LABELS[liveParse.parsed.contact.stage]}
                </span>
              </div>

              <div className="detail-meta-grid">
                <div>
                  <div className="meta-label">Deal</div>
                  <div className="meta-val mono">
                    {formatCurrency(
                      liveParse.parsed.contact.deal_value,
                      liveParse.parsed.contact.currency,
                    )}
                  </div>
                </div>
                <div>
                  <div className="meta-label">Follow-Up</div>
                  <div className="meta-val mono">
                    {liveParse.parsed.contact.next_followup ?? "-"}
                  </div>
                </div>
                <div>
                  <div className="meta-label">Email</div>
                  <div className="meta-val">{liveParse.parsed.contact.email || "-"}</div>
                </div>
                <div>
                  <div className="meta-label">Owner</div>
                  <div className="meta-val mono">{liveParse.parsed.contact.owner}</div>
                </div>
              </div>

              {liveParse.parsed.contact.tags.length > 0 && (
                <div className="tag-row">
                  {liveParse.parsed.contact.tags.map((tag) => (
                    <span key={tag} className="pill mono">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              <div>
                <div className="section-label">Context</div>
                <div className="context-box">
                  {liveParse.parsed.contact.context || "Empty context section."}
                </div>
              </div>

              <div>
                <div className="section-label">
                  Timeline ({liveParse.parsed.contact.timeline.length})
                </div>
                <div className="timeline-list">
                  {liveParse.parsed.contact.timeline.map((item, idx) => (
                    <div key={idx} className="timeline-item">
                      <div className="timeline-head mono">
                        <span>{item.date}</span>
                        <span>{item.kind}</span>
                      </div>
                      <div>{item.note}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="section-label">
                  Tasks ({liveParse.parsed.contact.tasks.length})
                </div>
                <div className="task-list">
                  {liveParse.parsed.contact.tasks.map((t, idx) => (
                    <div key={idx} className="task-row" style={{ cursor: "default" }}>
                      <span className="mono">[{t.done ? "x" : " "}]</span>
                      <span className={t.done ? "task-done" : ""}>{t.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
