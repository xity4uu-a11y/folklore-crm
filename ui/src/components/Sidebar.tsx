import type { ActiveView, VaultSnapshot } from "../types";

interface SidebarProps {
  activeView: ActiveView;
  onSelectView: (view: ActiveView) => void;
  snapshot: VaultSnapshot;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenPalette: () => void;
  isDesktop: boolean;
}

export function Sidebar({
  activeView,
  onSelectView,
  snapshot,
  theme,
  onToggleTheme,
  onOpenPalette,
  isDesktop,
}: SidebarProps) {
  const alertCount =
    snapshot.summary.overdue_followups.length +
    snapshot.summary.stale_contacts.length;

  const navItems: Array<{
    id: ActiveView;
    label: string;
    badge?: string;
    badgeTone?: "default" | "warn" | "fail";
  }> = [
    {
      id: "contacts",
      label: "Contacts",
      badge: String(snapshot.summary.total_contacts),
    },
    {
      id: "pipeline",
      label: "Pipeline Board",
      badge: String(snapshot.summary.open_deals),
    },
    {
      id: "radar",
      label: "Follow-Up Radar",
      badge: alertCount > 0 ? String(alertCount) : "0",
      badgeTone:
        snapshot.summary.overdue_followups.length > 0
          ? "fail"
          : alertCount > 0
            ? "warn"
            : "default",
    },
    {
      id: "editor",
      label: "Markdown Editor",
      badge: ".md",
    },
    {
      id: "git",
      label: "Git History",
      badge: snapshot.git_status.clean
        ? "clean"
        : String(snapshot.git_status.modified_files.length),
      badgeTone: snapshot.git_status.clean ? "default" : "warn",
    },
    {
      id: "plugins",
      label: "Plugins & Export",
    },
  ];

  return (
    <aside className="sidebar">
      <div className="brand-header">
        <div className="brand-mark">
          <div className="brand-badge">F</div>
          <div>
            <div className="brand-title">Folklore CRM</div>
            <div className="brand-sub">Plain-Text Git Vault</div>
          </div>
        </div>
        <span className="pill mono">$0/seat</span>
      </div>

      <button type="button" className="cmd-trigger" onClick={onOpenPalette}>
        <span>Quick jump...</span>
        <span className="kbd mono">Ctrl+K</span>
      </button>

      <nav className="nav-list" aria-label="Main navigation">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${activeView === item.id ? "active" : ""}`}
            onClick={() => onSelectView(item.id)}
          >
            <span>{item.label}</span>
            {item.badge !== undefined && (
              <span
                className={`nav-count mono ${
                  item.badgeTone && item.badgeTone !== "default"
                    ? item.badgeTone
                    : ""
                }`}
              >
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="vault-card">
          <div className="vault-row">
            <span>
              <span
                className={`status-dot ${
                  snapshot.git_status.clean ? "clean" : "dirty"
                }`}
              />
              <span className="mono">{snapshot.git_status.branch}</span>
            </span>
            <span className="mono">
              {snapshot.git_status.head_hash ?? "uncommitted"}
            </span>
          </div>
          <div className="vault-path mono" title={snapshot.vault_path}>
            {snapshot.vault_path}
          </div>
          <div className="vault-row">
            <span>Mode</span>
            <span className="mono">{isDesktop ? "Tauri Local FS" : "Browser Vault"}</span>
          </div>
        </div>

        <div className="sidebar-actions">
          <button
            type="button"
            className="btn btn-sm"
            style={{ flex: 1 }}
            onClick={onToggleTheme}
          >
            Theme: {theme === "light" ? "Light" : "Dark"}
          </button>
        </div>
      </div>
    </aside>
  );
}
