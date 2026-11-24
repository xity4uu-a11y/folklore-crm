import { useState } from "react";
import type { Contact, PipelineStage } from "../types";
import { slugify } from "../lib/markdown";
import { STAGE_LABELS, STAGE_ORDER } from "../lib/pipeline";

interface NewContactModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (contact: Contact) => Promise<void>;
}

export function NewContactModal({ open, onClose, onCreate }: NewContactModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [stage, setStage] = useState<PipelineStage>("lead");
  const [dealValue, setDealValue] = useState("10000");
  const [followup, setFollowup] = useState("");
  const [tags, setTags] = useState("inbound");
  const [context, setContext] = useState("");

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const id = slugify(name);
    const contact: Contact = {
      id,
      name: name.trim(),
      email: email.trim(),
      company: company.trim(),
      role: role.trim(),
      stage,
      deal_value: Math.max(0, Number(dealValue) || 0),
      currency: "USD",
      next_followup: followup.trim() || null,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      owner: "founder",
      website: "",
      phone: "",
      context: context.trim(),
      timeline: [],
      tasks: [],
      file_path: `contacts/${id}.md`,
    };
    await onCreate(contact);
    setName("");
    setEmail("");
    setCompany("");
    setRole("");
    setStage("lead");
    setDealValue("10000");
    setFollowup("");
    setTags("inbound");
    setContext("");
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span className="panel-title">New Plain-Text Contact</span>
          <span className="cell-secondary mono">
            contacts/{name.trim() ? slugify(name) : "contact"}.md
          </span>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <label className="form-field">
              <span className="meta-label">Full Name</span>
              <input
                className="input"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
              />
            </label>
            <label className="form-field">
              <span className="meta-label">Email</span>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ada@analytical.io"
              />
            </label>
            <label className="form-field">
              <span className="meta-label">Company</span>
              <input
                className="input"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Analytical Engines"
              />
            </label>
            <label className="form-field">
              <span className="meta-label">Role</span>
              <input
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="VP of Engineering"
              />
            </label>
            <label className="form-field">
              <span className="meta-label">Stage</span>
              <select
                className="select"
                value={stage}
                onChange={(e) => setStage(e.target.value as PipelineStage)}
              >
                {STAGE_ORDER.map((st) => (
                  <option key={st} value={st}>
                    {STAGE_LABELS[st]}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span className="meta-label">Deal Value (USD)</span>
              <input
                type="number"
                min={0}
                step={500}
                className="input mono"
                value={dealValue}
                onChange={(e) => setDealValue(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span className="meta-label">Next Follow-Up</span>
              <input
                type="date"
                className="input mono"
                value={followup}
                onChange={(e) => setFollowup(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span className="meta-label">Tags (comma-separated)</span>
              <input
                className="input mono"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="enterprise, security"
              />
            </label>
            <label className="form-field full">
              <span className="meta-label">Context Notes</span>
              <textarea
                className="input"
                rows={3}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Key requirements, migration timeline, decision criteria..."
              />
            </label>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              padding: "12px 16px",
              borderTop: "1px solid var(--border-hairline)",
              background: "var(--bg-subtle)",
            }}
          >
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create .md File
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
