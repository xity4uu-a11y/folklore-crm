import { useCallback, useEffect, useState } from "react";
import type { ActiveView, Contact, PipelineStage, PluginManifest, VaultSnapshot } from "./types";
import { todayIsoDate } from "./lib/pipeline";
import { vaultBridge } from "./lib/vaultBridge";
import { Sidebar } from "./components/Sidebar";
import { ContactsView } from "./components/ContactsView";
import { KanbanPipeline } from "./components/KanbanPipeline";
import { FollowUpRadar } from "./components/FollowUpRadar";
import { MarkdownSplitEditor } from "./components/MarkdownSplitEditor";
import { GitHistoryPanel } from "./components/GitHistoryPanel";
import { PluginsExportView } from "./components/PluginsExportView";
import { CommandPalette } from "./components/CommandPalette";
import { NewContactModal } from "./components/NewContactModal";

const VIEW_META: Record<ActiveView, { title: string; subtitle: string }> = {
  contacts: {
    title: "Contacts",
    subtitle: "Plain-text YAML frontmatter + Markdown records stored locally in Git",
  },
  pipeline: {
    title: "Pipeline Board",
    subtitle: "Drag cards or switch stages to update frontmatter in contacts/*.md",
  },
  radar: {
    title: "Follow-Up & Stale Radar",
    subtitle: "Proactive triage for overdue follow-ups and deals quiet >14 days",
  },
  editor: {
    title: "Markdown Split Editor",
    subtitle: "Edit raw Markdown directly with instant structured card preview",
  },
  git: {
    title: "Git History & Time-Travel",
    subtitle: "Commit plain-text diffs, inspect snapshots, and rollback any contact in 1 click",
  },
  plugins: {
    title: "Plugins & Portable Exports",
    subtitle: "Schema-validated community manifests and zero lock-in CSV/vCard exports",
  },
};

export function App() {
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>("contacts");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [toast, setToast] = useState<{ tone: "pass" | "fail"; text: string } | null>(null);

  const notify = useCallback((tone: "pass" | "fail", text: string) => {
    setToast({ tone, text });
  }, []);

  const refreshVault = useCallback(async () => {
    try {
      const next = await vaultBridge.loadVault();
      setSnapshot(next);
      setSelectedId((prev) =>
        prev && next.contacts.some((c) => c.id === prev)
          ? prev
          : (next.contacts[0]?.id ?? null),
      );
    } catch (err) {
      notify("fail", err instanceof Error ? err.message : String(err));
    }
  }, [notify]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    void refreshVault();
    void vaultBridge.listPlugins().then(setPlugins).catch(() => {});

    let unlisten: (() => void) | undefined;
    void vaultBridge
      .subscribeExternalSync(() => {
        void refreshVault();
        notify("pass", "External editor change detected; vault reloaded from disk.");
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [refreshVault, notify]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function handleSaveContact(contact: Contact) {
    try {
      const next = await vaultBridge.saveContact(contact);
      setSnapshot(next);
      setSelectedId(contact.id);
      notify("pass", `Saved contacts/${contact.id}.md`);
    } catch (err) {
      notify("fail", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleMoveStage(contact: Contact, stage: PipelineStage) {
    await handleSaveContact({ ...contact, stage });
  }

  async function handleAppendInteraction(
    id: string,
    date: string,
    kind: string,
    note: string,
  ) {
    try {
      const next = await vaultBridge.appendInteraction(id, date, kind, note);
      setSnapshot(next);
      notify("pass", `Logged ${kind} on contacts/${id}.md`);
    } catch (err) {
      notify("fail", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleToggleTask(id: string, taskIndex: number) {
    try {
      const next = await vaultBridge.toggleTask(id, taskIndex);
      setSnapshot(next);
    } catch (err) {
      notify("fail", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteContact(id: string) {
    try {
      const next = await vaultBridge.deleteContact(id);
      setSnapshot(next);
      setSelectedId(next.contacts[0]?.id ?? null);
      notify("pass", `Removed contacts/${id}.md`);
    } catch (err) {
      notify("fail", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveRawMarkdown(id: string, raw: string) {
    try {
      const next = await vaultBridge.saveRawMarkdown(id, raw);
      setSnapshot(next);
      notify("pass", `Saved raw Markdown to contacts/${id}.md`);
    } catch (err) {
      notify("fail", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCommit(message: string) {
    try {
      const res = await vaultBridge.gitCommit(message);
      await refreshVault();
      notify(
        "pass",
        res.committed
          ? `Committed ${res.commit_hash ?? "HEAD"} — ${res.message}`
          : res.message,
      );
    } catch (err) {
      notify("fail", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRestoreRevision(id: string, rev: string) {
    try {
      const next = await vaultBridge.gitRestore(id, rev);
      setSnapshot(next);
      notify("pass", `Restored contacts/${id}.md to revision ${rev}`);
    } catch (err) {
      notify("fail", err instanceof Error ? err.message : String(err));
    }
  }

  if (!snapshot) {
    return <div className="empty-state">Loading Folklore CRM vault...</div>;
  }

  const meta = VIEW_META[activeView];

  return (
    <div className="app-shell">
      <Sidebar
        activeView={activeView}
        onSelectView={setActiveView}
        snapshot={snapshot}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        onOpenPalette={() => setPaletteOpen(true)}
        isDesktop={vaultBridge.isDesktop()}
      />

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-title-group">
            <h1 className="topbar-title">{meta.title}</h1>
            <span className="topbar-subtitle">{meta.subtitle}</span>
          </div>
          <div className="topbar-actions">
            {!snapshot.git_status.clean && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setActiveView("git")}
              >
                Commit ({snapshot.git_status.modified_files.length})
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void refreshVault()}
            >
              Sync Disk
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setNewModalOpen(true)}
            >
              + New Contact
            </button>
          </div>
        </header>

        {toast && (
          <div className={`banner-toast ${toast.tone}`}>
            <span>{toast.text}</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setToast(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="content-scroll">
          {activeView === "contacts" && (
            <ContactsView
              snapshot={snapshot}
              selectedId={selectedId}
              onSelectContact={setSelectedId}
              onUpdateStage={handleMoveStage}
              onAppendInteraction={handleAppendInteraction}
              onToggleTask={handleToggleTask}
              onDeleteContact={handleDeleteContact}
              onOpenEditor={(id) => {
                setSelectedId(id);
                setActiveView("editor");
              }}
              onOpenHistory={(id) => {
                setSelectedId(id);
                setActiveView("git");
              }}
            />
          )}

          {activeView === "pipeline" && (
            <KanbanPipeline
              snapshot={snapshot}
              onMoveStage={handleMoveStage}
              onSelectContact={(id) => {
                setSelectedId(id);
                setActiveView("contacts");
              }}
            />
          )}

          {activeView === "radar" && (
            <FollowUpRadar
              snapshot={snapshot}
              onSelectContact={(id) => {
                setSelectedId(id);
                setActiveView("contacts");
              }}
              onQuickCheckIn={async (id) => {
                await handleAppendInteraction(
                  id,
                  todayIsoDate(),
                  "email",
                  "Sent follow-up check-in from Folklore Radar.",
                );
              }}
              onBumpFollowup={async (contact, nextDate) => {
                await handleSaveContact({ ...contact, next_followup: nextDate });
              }}
            />
          )}

          {activeView === "editor" && (
            <MarkdownSplitEditor
              snapshot={snapshot}
              selectedId={selectedId}
              onSelectContact={setSelectedId}
              loadRawMarkdown={vaultBridge.getRawMarkdown}
              onSaveRawMarkdown={handleSaveRawMarkdown}
            />
          )}

          {activeView === "git" && (
            <GitHistoryPanel
              snapshot={snapshot}
              selectedId={selectedId}
              onSelectContact={setSelectedId}
              onCommit={handleCommit}
              loadHistory={vaultBridge.gitHistory}
              showRevision={vaultBridge.gitShowRevision}
              onRestoreRevision={handleRestoreRevision}
            />
          )}

          {activeView === "plugins" && (
            <PluginsExportView
              plugins={plugins}
              onTogglePlugin={
                vaultBridge.isDesktop()
                  ? undefined
                  : (id) => setPlugins(vaultBridge.toggleBrowserPlugin(id))
              }
              onExportCsv={vaultBridge.exportCsv}
              onExportVcf={vaultBridge.exportVcf}
            />
          )}
        </div>
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        contacts={snapshot.contacts}
        onNavigate={setActiveView}
        onSelectContact={setSelectedId}
        onNewContact={() => setNewModalOpen(true)}
        onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        onQuickCommit={() =>
          void handleCommit(`chore(vault): snapshot crm updates (${todayIsoDate()})`)
        }
      />

      <NewContactModal
        open={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        onCreate={handleSaveContact}
      />
    </div>
  );
}
