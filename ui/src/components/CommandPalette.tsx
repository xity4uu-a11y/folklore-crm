import { useEffect, useMemo, useState } from "react";
import type { ActiveView, Contact } from "../types";

export interface PaletteAction {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  contacts: Contact[];
  onNavigate: (view: ActiveView) => void;
  onSelectContact: (id: string) => void;
  onNewContact: () => void;
  onToggleTheme: () => void;
  onQuickCommit: () => void;
}

export function CommandPalette({
  open,
  onClose,
  contacts,
  onNavigate,
  onSelectContact,
  onNewContact,
  onToggleTheme,
  onQuickCommit,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const actions = useMemo<PaletteAction[]>(() => {
    const base: PaletteAction[] = [
      {
        id: "new-contact",
        label: "New Contact (.md)",
        hint: "Action",
        run: onNewContact,
      },
      {
        id: "nav-contacts",
        label: "Go to Contacts Directory",
        hint: "View",
        run: () => onNavigate("contacts"),
      },
      {
        id: "nav-pipeline",
        label: "Go to Kanban Pipeline Board",
        hint: "View",
        run: () => onNavigate("pipeline"),
      },
      {
        id: "nav-radar",
        label: "Go to Follow-Up & Stale Radar",
        hint: "View",
        run: () => onNavigate("radar"),
      },
      {
        id: "nav-editor",
        label: "Go to Split Markdown Editor",
        hint: "View",
        run: () => onNavigate("editor"),
      },
      {
        id: "nav-git",
        label: "Go to Git History & Time-Travel",
        hint: "View",
        run: () => onNavigate("git"),
      },
      {
        id: "nav-plugins",
        label: "Go to Plugins & Portable Exports",
        hint: "View",
        run: () => onNavigate("plugins"),
      },
      {
        id: "quick-commit",
        label: "Commit Pending Vault Changes to Git",
        hint: "Git",
        run: onQuickCommit,
      },
      {
        id: "toggle-theme",
        label: "Switch Light / Dark Appearance",
        hint: "Theme",
        run: onToggleTheme,
      },
    ];

    const contactItems: PaletteAction[] = contacts.map((c) => ({
      id: `contact-${c.id}`,
      label: `${c.name} (${c.company || c.id})`,
      hint: `contacts/${c.id}.md`,
      run: () => {
        onSelectContact(c.id);
        onNavigate("contacts");
      },
    }));

    const all = [...base, ...contactItems];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q),
    );
  }, [
    contacts,
    query,
    onNavigate,
    onNewContact,
    onQuickCommit,
    onSelectContact,
    onToggleTheme,
  ]);

  if (!open) return null;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, Math.max(actions.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && actions[activeIndex]) {
      e.preventDefault();
      actions[activeIndex].run();
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid var(--border-hairline)",
          }}
        >
          <input
            type="text"
            autoFocus
            className="input"
            style={{ width: "100%", border: "none", padding: "4px 2px" }}
            placeholder="Jump to a contact, view, or Git action..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
          />
        </div>
        <div className="palette-list">
          {actions.length === 0 ? (
            <div className="empty-state">No matching commands or contacts.</div>
          ) : (
            actions.map((action, idx) => (
              <button
                key={action.id}
                type="button"
                className={`palette-item ${idx === activeIndex ? "highlighted" : ""}`}
                onClick={() => {
                  action.run();
                  onClose();
                }}
              >
                <span>{action.label}</span>
                <span className="cell-secondary mono">{action.hint}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
