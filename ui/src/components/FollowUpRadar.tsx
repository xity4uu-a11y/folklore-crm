import type { Contact, VaultSnapshot } from "../types";
import {
  STAGE_LABELS,
  addDaysIso,
  daysSinceLastTouch,
  formatCurrency,
  todayIsoDate,
} from "../lib/pipeline";

interface FollowUpRadarProps {
  snapshot: VaultSnapshot;
  onSelectContact: (id: string) => void;
  onQuickCheckIn: (id: string) => Promise<void>;
  onBumpFollowup: (contact: Contact, nextDate: string) => Promise<void>;
}

export function FollowUpRadar({
  snapshot,
  onSelectContact,
  onQuickCheckIn,
  onBumpFollowup,
}: FollowUpRadarProps) {
  const today = todayIsoDate();
  const byId = new Map(snapshot.contacts.map((c) => [c.id, c]));

  const overdue = snapshot.summary.overdue_followups
    .map((id) => byId.get(id))
    .filter((c): c is Contact => Boolean(c));
  const dueSoon = snapshot.summary.due_soon_followups
    .map((id) => byId.get(id))
    .filter((c): c is Contact => Boolean(c));
  const stale = snapshot.summary.stale_contacts
    .map((id) => byId.get(id))
    .filter((c): c is Contact => Boolean(c));

  function renderList(
    title: string,
    tone: "fail" | "warn" | "pass",
    items: Contact[],
    emptyText: string,
    subtitle: (c: Contact) => string,
  ) {
    return (
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">{title}</span>
          <span className={`pill pill-${tone} mono`}>{items.length}</span>
        </div>
        {items.length === 0 ? (
          <div className="empty-state">{emptyText}</div>
        ) : (
          items.map((contact) => (
            <div key={contact.id} className="radar-card">
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
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
                    fontWeight: 600,
                    textAlign: "left",
                  }}
                >
                  {contact.name}
                </button>
                <span className="mono" style={{ fontSize: 12 }}>
                  {formatCurrency(contact.deal_value, contact.currency)}
                </span>
              </div>
              <div className="cell-secondary">
                {contact.company} | {STAGE_LABELS[contact.stage]}
              </div>
              <div className="cell-secondary mono">{subtitle(contact)}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void onQuickCheckIn(contact.id)}
                >
                  Log Check-In
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    void onBumpFollowup(contact, addDaysIso(today, 7))
                  }
                >
                  Bump +7d
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="radar-grid">
      {renderList(
        "Overdue Follow-Ups",
        overdue.length > 0 ? "fail" : "pass",
        overdue,
        "Zero overdue follow-ups.",
        (c) => `Due ${c.next_followup ?? "unset"}`,
      )}
      {renderList(
        "Due Within 7 Days",
        dueSoon.length > 0 ? "warn" : "pass",
        dueSoon,
        "No follow-ups scheduled in the next 7 days.",
        (c) => `Scheduled ${c.next_followup ?? "unset"}`,
      )}
      {renderList(
        "Stale Relationships (>14d)",
        stale.length > 0 ? "warn" : "pass",
        stale,
        "All open deals touched within 14 days.",
        (c) => {
          const days = daysSinceLastTouch(c, today);
          return days === null
            ? "No timeline interactions yet"
            : `${days} days since last touch`;
        },
      )}
    </div>
  );
}
