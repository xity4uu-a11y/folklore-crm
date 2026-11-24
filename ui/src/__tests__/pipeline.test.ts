import { describe, expect, it } from "vitest";
import { computeVaultSummary, filterAndSearchContacts } from "../lib/pipeline";
import { SEED_CONTACTS } from "../lib/seedVault";
import { vaultBridge } from "../lib/vaultBridge";

describe("pipeline forecasting, radar & search", () => {
  it("computes weighted pipeline, won totals, overdue follow-ups, and stale radar", () => {
    const summary = computeVaultSummary(SEED_CONTACTS, "2026-11-25", 14);

    // Open deals: elena(24000 proposal .60), marcus(18500 negotiation .80),
    // priya(12000 qualified .35), hannah(15000 lead .15), david(21000 proposal .60)
    expect(summary.total_contacts).toBe(6);
    expect(summary.open_deals).toBe(5);
    expect(summary.total_pipeline_value).toBe(90500);
    expect(summary.weighted_pipeline_value).toBeCloseTo(
      24000 * 0.6 + 18500 * 0.8 + 12000 * 0.35 + 15000 * 0.15 + 21000 * 0.6,
      5,
    );
    expect(summary.won_value).toBe(9600);

    // Hannah follow-up 2026-11-18 is overdue vs 2026-11-25 and last touch 2026-10-28 (>14d stale)
    expect(summary.overdue_followups).toEqual(["hannah-lindqvist"]);
    expect(summary.stale_contacts).toEqual(["hannah-lindqvist"]);

    // Elena (12-01, +6d), Marcus (11-28, +3d), David (11-26, +1d) are due within 7 days
    expect(summary.due_soon_followups).toContain("elena-rostova");
    expect(summary.due_soon_followups).toContain("marcus-chen");
    expect(summary.due_soon_followups).toContain("david-okafor");
  });

  it("supports multi-token search and stage/tag filters", () => {
    const byQuery = filterAndSearchContacts(SEED_CONTACTS, {
      query: "elena soc2",
    });
    expect(byQuery.map((c) => c.id)).toEqual(["elena-rostova"]);

    const byStage = filterAndSearchContacts(SEED_CONTACTS, {
      stage: "proposal",
    });
    expect(byStage.map((c) => c.id).sort()).toEqual([
      "david-okafor",
      "elena-rostova",
    ]);

    const byTag = filterAndSearchContacts(SEED_CONTACTS, {
      tag: "security",
    });
    expect(byTag.map((c) => c.id).sort()).toEqual([
      "elena-rostova",
      "tomasz-kowalski",
    ]);
  });

  it("updates stages, commits changes, and rolls back via Git time-travel in vault bridge", async () => {
    const initial = await vaultBridge.loadVault();
    const elena = initial.contacts.find((c) => c.id === "elena-rostova")!;
    expect(elena.stage).toBe("proposal");

    const updated = await vaultBridge.saveContact({ ...elena, stage: "won" });
    expect(updated.git_status.clean).toBe(false);
    expect(updated.contacts.find((c) => c.id === "elena-rostova")?.stage).toBe("won");

    const commitRes = await vaultBridge.gitCommit("deal(elena-rostova): close won");
    expect(commitRes.committed).toBe(true);

    const history = await vaultBridge.gitHistory("elena-rostova");
    expect(history.length).toBeGreaterThanOrEqual(2);

    // Restore back to previous revision where stage was proposal
    const prevRev = history[1].short_hash;
    const restored = await vaultBridge.gitRestore("elena-rostova", prevRev);
    expect(restored.contacts.find((c) => c.id === "elena-rostova")?.stage).toBe("proposal");
  });
});
