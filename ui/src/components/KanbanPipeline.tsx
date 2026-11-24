import { useState } from "react";
import type { Contact, PipelineStage, VaultSnapshot } from "../types";
import {
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_PROBABILITIES,
  formatCurrency,
} from "../lib/pipeline";

interface KanbanPipelineProps {
  snapshot: VaultSnapshot;
  onMoveStage: (contact: Contact, stage: PipelineStage) => Promise<void>;
  onSelectContact: (id: string) => void;
}

export function KanbanPipeline({
  snapshot,
  onMoveStage,
  onSelectContact,
}: KanbanPipelineProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<PipelineStage | null>(null);

  async function handleDrop(stage: PipelineStage) {
    setOverStage(null);
    if (!draggedId) return;
    const contact = snapshot.contacts.find((c) => c.id === draggedId);
    setDraggedId(null);
    if (contact && contact.stage !== stage) {
      await onMoveStage(contact, stage);
    }
  }

  return (
    <div>
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Open Value</div>
          <div className="metric-value">
            {formatCurrency(snapshot.summary.total_pipeline_value)}
          </div>
          <div className="metric-hint">Lead through Negotiation</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Weighted Forecast</div>
          <div className="metric-value">
            {formatCurrency(snapshot.summary.weighted_pipeline_value)}
          </div>
          <div className="metric-hint">Probability-weighted revenue</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Closed Won</div>
          <div className="metric-value">{formatCurrency(snapshot.summary.won_value)}</div>
          <div className="metric-hint">Booked in plain-text Git</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Open Tasks</div>
          <div className="metric-value">{snapshot.summary.open_tasks_count}</div>
          <div className="metric-hint">Tracked inside ## Tasks</div>
        </div>
      </div>

      <div className="kanban-board">
        {STAGE_ORDER.map((stage) => {
          const cards = snapshot.contacts.filter((c) => c.stage === stage);
          const stageSummary = snapshot.summary.stages.find((s) => s.stage === stage);
          return (
            <div
              key={stage}
              className={`kanban-col ${overStage === stage ? "drag-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(stage);
              }}
              onDragLeave={() => setOverStage(null)}
              onDrop={(e) => {
                e.preventDefault();
                void handleDrop(stage);
              }}
            >
              <div className="kanban-col-head">
                <div className="kanban-col-top">
                  <span className={`pill pill-stage-${stage}`}>
                    {STAGE_LABELS[stage]}
                  </span>
                  <span className="cell-secondary mono">
                    {cards.length} | {Math.round(STAGE_PROBABILITIES[stage] * 100)}%
                  </span>
                </div>
                <div className="cell-secondary mono">
                  Raw {formatCurrency(stageSummary?.total_value ?? 0)} | Wtd{" "}
                  {formatCurrency(stageSummary?.weighted_value ?? 0)}
                </div>
              </div>

              <div className="kanban-cards">
                {cards.length === 0 ? (
                  <div className="cell-secondary" style={{ padding: "8px 4px" }}>
                    Drop contact here
                  </div>
                ) : (
                  cards.map((contact) => (
                    <div
                      key={contact.id}
                      className="kanban-card"
                      draggable
                      onDragStart={() => setDraggedId(contact.id)}
                      onDragEnd={() => {
                        setDraggedId(null);
                        setOverStage(null);
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          gap: 8,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectContact(contact.id)}
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            cursor: "pointer",
                            textAlign: "left",
                            fontWeight: 600,
                          }}
                        >
                          {contact.name}
                        </button>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                          {formatCurrency(contact.deal_value, contact.currency)}
                        </span>
                      </div>

                      <div className="cell-secondary">{contact.company}</div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 6,
                        }}
                      >
                        <span className="cell-secondary mono">
                          {contact.next_followup ?? "no follow-up"}
                        </span>
                        <select
                          aria-label={`Move ${contact.name} stage`}
                          className="select"
                          style={{ padding: "2px 6px", fontSize: 11.5 }}
                          value={contact.stage}
                          onChange={(e) =>
                            void onMoveStage(contact, e.target.value as PipelineStage)
                          }
                        >
                          {STAGE_ORDER.map((st) => (
                            <option key={st} value={st}>
                              {STAGE_LABELS[st]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
