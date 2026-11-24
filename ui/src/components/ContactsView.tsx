import { useMemo, useState } from "react";
import type { Contact, PipelineStage, VaultSnapshot } from "../types";
import {
  STAGE_LABELS,
  STAGE_ORDER,
  filterAndSearchContacts,
  formatCurrency,
  lastInteractionDate,
  todayIsoDate,
} from "../lib/pipeline";

interface ContactsViewProps {
  snapshot: VaultSnapshot;
  selectedId: string | null;
  onSelectContact: (id: string) => void;
  onUpdateStage: (contact: Contact, nextStage: PipelineStage) => Promise<void>;
  onAppendInteraction: (id: string, date: string, kind: string, note: string) => Promise<void>;
  onToggleTask: (id: string, taskIndex: number) => Promise<void>;
  onDeleteContact: (id: string) => Promise<void>;
  onOpenEditor: (id: string) => void;
  onOpenHistory: (id: string) => void;
}

export function ContactsView({
  snapshot,
  selectedId,
  onSelectContact,
  onUpdateStage,
  onAppendInteraction,
  onToggleTask,
  onDeleteContact,
  onOpenEditor,
  onOpenHistory,
}: ContactsViewProps) {
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [logKind, setLogKind] = useState("call");
  const [logNote, setLogNote] = useState("");

  const filtered = useMemo(
    () =>
      filterAndSearchContacts(snapshot.contacts, {
        query,
        stage: stageFilter,
        tag: tagFilter,
      }),
    [snapshot.contacts, query, stageFilter, tagFilter],
  );

  const selectedContact =
    filtered.find((c) => c.id === selectedId) ??
    snapshot.contacts.find((c) => c.id === selectedId) ??
    filtered[0] ??
    null;

  async function handleLogSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedContact || !logNote.trim()) return;
    await onAppendInteraction(selectedContact.id, todayIsoDate(), logKind, logNote.trim());
    setLogNote("");
  }

  return (
    <div>
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Open Pipeline</div>
          <div className="metric-value">
            {formatCurrency(snapshot.summary.total_pipeline_value)}
          </div>
          <div className="metric-hint">{snapshot.summary.open_deals} active opportunities</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Weighted Forecast</div>
          <div className="metric-value">
            {formatCurrency(snapshot.summary.weighted_pipeline_value)}
          </div>
          <div className="metric-hint">Stage probability adjusted</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Closed Won</div>
          <div className="metric-value">{formatCurrency(snapshot.summary.won_value)}</div>
          <div className="metric-hint">Plain-text Git verified</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">SaaS Seat Cost</div>
          <div className="metric-value mono">$0/mo</div>
          <div className="metric-hint">vs $50-$150/seat cloud CRM</div>
        </div>
      </div>

      <div className="filter-bar">
        <input
          type="search"
          className="input search-input"
          placeholder="Search contacts, companies, tags, notes, or timeline..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="select"
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as PipelineStage | "all")}
          aria-label="Filter by stage"
        >
          <option value="all">All Stages</option>
          {STAGE_ORDER.map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABELS[stage]}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          aria-label="Filter by tag"
        >
          <option value="all">All Tags</option>
          {snapshot.summary.tag_counts.map((item) => (
            <option key={item.tag} value={item.tag}>
              #{item.tag} ({item.count})
            </option>
          ))}
        </select>
      </div>

      <div className="contacts-layout">
        <div className="panel">
          {filtered.length === 0 ? (
            <div className="empty-state">No contacts match the active search filters.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Stage</th>
                  <th>Deal</th>
                  <th>Follow-Up</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((contact) => {
                  const isOverdue = snapshot.summary.overdue_followups.includes(contact.id);
                  return (
                    <tr
                      key={contact.id}
                      className={selectedContact?.id === contact.id ? "selected" : ""}
                      onClick={() => onSelectContact(contact.id)}
                    >
                      <td>
                        <div className="cell-primary">{contact.name}</div>
                        <div className="cell-secondary">
                          {contact.company}
                          {contact.role ? ` — ${contact.role}` : ""}
                        </div>
                      </td>
                      <td>
                        <span className={`pill pill-stage-${contact.stage}`}>
                          {STAGE_LABELS[contact.stage]}
                        </span>
                      </td>
                      <td className="mono">
                        {formatCurrency(contact.deal_value, contact.currency)}
                      </td>
                      <td>
                        {contact.next_followup ? (
                          <span className={`mono ${isOverdue ? "pill pill-fail" : ""}`}>
                            {contact.next_followup}
                          </span>
                        ) : (
                          <span className="cell-secondary">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          {!selectedContact ? (
            <div className="empty-state">Select a contact to inspect its Markdown record.</div>
          ) : (
            <>
              <div className="panel-header">
                <div>
                  <div className="panel-title">{selectedContact.name}</div>
                  <div className="cell-secondary mono">{selectedContact.file_path}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onOpenEditor(selectedContact.id)}
                  >
                    Edit .md
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onOpenHistory(selectedContact.id)}
                  >
                    History
                  </button>
                </div>
              </div>

              <div className="detail-body">
                <div className="detail-meta-grid">
                  <div>
                    <div className="meta-label">Stage</div>
                    <select
                      className="select"
                      style={{ marginTop: 4, width: "100%", padding: "4px 8px" }}
                      value={selectedContact.stage}
                      onChange={(e) =>
                        void onUpdateStage(selectedContact, e.target.value as PipelineStage)
                      }
                    >
                      {STAGE_ORDER.map((st) => (
                        <option key={st} value={st}>
                          {STAGE_LABELS[st]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="meta-label">Deal Value</div>
                    <div className="meta-val mono" style={{ marginTop: 6 }}>
                      {formatCurrency(selectedContact.deal_value, selectedContact.currency)}
                    </div>
                  </div>
                  <div>
                    <div className="meta-label">Email</div>
                    <div className="meta-val">{selectedContact.email || "-"}</div>
                  </div>
                  <div>
                    <div className="meta-label">Phone</div>
                    <div className="meta-val mono">{selectedContact.phone || "-"}</div>
                  </div>
                  <div>
                    <div className="meta-label">Company / Role</div>
                    <div className="meta-val">
                      {selectedContact.company}
                      {selectedContact.role ? ` (${selectedContact.role})` : ""}
                    </div>
                  </div>
                  <div>
                    <div className="meta-label">Last Touch</div>
                    <div className="meta-val mono">
                      {lastInteractionDate(selectedContact) ?? "none"}
                    </div>
                  </div>
                </div>

                {selectedContact.tags.length > 0 && (
                  <div className="tag-row">
                    {selectedContact.tags.map((tag) => (
                      <span key={tag} className="pill mono">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                <div>
                  <div className="section-label">Context</div>
                  <div className="context-box">
                    {selectedContact.context || "No context notes recorded."}
                  </div>
                </div>

                <div>
                  <div className="section-label">
                    Timeline ({selectedContact.timeline.length})
                  </div>
                  <div className="timeline-list">
                    {selectedContact.timeline.length === 0 ? (
                      <div className="cell-secondary">No interactions logged yet.</div>
                    ) : (
                      selectedContact.timeline.map((item, idx) => (
                        <div key={`${item.date}-${idx}`} className="timeline-item">
                          <div className="timeline-head mono">
                            <span>{item.date}</span>
                            <span>{item.kind}</span>
                          </div>
                          <div>{item.note}</div>
                        </div>
                      ))
                    )}
                  </div>
                  <form className="inline-form" onSubmit={handleLogSubmit}>
                    <select
                      className="select"
                      value={logKind}
                      onChange={(e) => setLogKind(e.target.value)}
                      aria-label="Interaction type"
                    >
                      <option value="call">call</option>
                      <option value="email">email</option>
                      <option value="meeting">meeting</option>
                      <option value="demo">demo</option>
                      <option value="note">note</option>
                    </select>
                    <input
                      type="text"
                      className="input"
                      style={{ flex: 1 }}
                      placeholder="Log interaction note..."
                      value={logNote}
                      onChange={(e) => setLogNote(e.target.value)}
                    />
                    <button type="submit" className="btn btn-primary btn-sm">
                      Log
                    </button>
                  </form>
                </div>

                <div>
                  <div className="section-label">
                    Tasks ({selectedContact.tasks.filter((t) => !t.done).length} open)
                  </div>
                  <div className="task-list">
                    {selectedContact.tasks.length === 0 ? (
                      <div className="cell-secondary">No tasks in ## Tasks section.</div>
                    ) : (
                      selectedContact.tasks.map((task, idx) => (
                        <label key={`${task.text}-${idx}`} className="task-row">
                          <input
                            type="checkbox"
                            checked={task.done}
                            onChange={() => void onToggleTask(selectedContact.id, idx)}
                          />
                          <span className={task.done ? "task-done" : ""}>{task.text}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => void onDeleteContact(selectedContact.id)}
                  >
                    Delete .md File
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
