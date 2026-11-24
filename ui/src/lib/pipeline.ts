import type { Contact, PipelineStage, StageSummary, VaultSummary } from "../types";

export const STAGE_ORDER: PipelineStage[] = [
  "lead",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

export const STAGE_PROBABILITIES: Record<PipelineStage, number> = {
  lead: 0.15,
  qualified: 0.35,
  proposal: 0.6,
  negotiation: 0.8,
  won: 1.0,
  lost: 0.0,
};

export function isOpenStage(stage: PipelineStage): boolean {
  return stage !== "won" && stage !== "lost";
}

function parseIsoDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.floor(utcMs / 86_400_000);
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(baseIso: string, days: number): string {
  const baseDay = parseIsoDay(baseIso);
  if (baseDay === null) return todayIsoDate();
  const next = new Date((baseDay + days) * 86_400_000);
  return next.toISOString().slice(0, 10);
}

export function lastInteractionDate(contact: Contact): string | null {
  let latest: string | null = null;
  for (const item of contact.timeline) {
    if (item.date && (!latest || item.date > latest)) {
      latest = item.date;
    }
  }
  return latest;
}

export function daysSinceLastTouch(contact: Contact, referenceIso: string): number | null {
  const refDay = parseIsoDay(referenceIso);
  const last = lastInteractionDate(contact);
  if (refDay === null || !last) return null;
  const lastDay = parseIsoDay(last);
  if (lastDay === null) return null;
  return refDay - lastDay;
}

export function daysUntilFollowup(contact: Contact, referenceIso: string): number | null {
  if (!contact.next_followup) return null;
  const refDay = parseIsoDay(referenceIso);
  const followDay = parseIsoDay(contact.next_followup);
  if (refDay === null || followDay === null) return null;
  return followDay - refDay;
}

export function computeVaultSummary(
  contacts: Contact[],
  referenceIso: string = todayIsoDate(),
  staleDays = 14,
): VaultSummary {
  let openDeals = 0;
  let totalPipelineValue = 0;
  let weightedPipelineValue = 0;
  let wonValue = 0;
  const overdueFollowups: string[] = [];
  const dueSoonFollowups: string[] = [];
  const staleContacts: string[] = [];
  let openTasksCount = 0;
  const tagMap = new Map<string, number>();

  const stageBuckets = new Map<
    PipelineStage,
    { count: number; total_value: number; weighted_value: number }
  >();
  for (const st of STAGE_ORDER) {
    stageBuckets.set(st, { count: 0, total_value: 0, weighted_value: 0 });
  }

  for (const c of contacts) {
    const prob = STAGE_PROBABILITIES[c.stage];
    const weighted = c.deal_value * prob;
    const bucket = stageBuckets.get(c.stage)!;
    bucket.count += 1;
    bucket.total_value += c.deal_value;
    bucket.weighted_value += weighted;

    if (isOpenStage(c.stage)) {
      if (c.deal_value > 0) openDeals += 1;
      totalPipelineValue += c.deal_value;
      weightedPipelineValue += weighted;

      const delta = daysUntilFollowup(c, referenceIso);
      if (delta !== null) {
        if (delta < 0) overdueFollowups.push(c.id);
        else if (delta <= 7) dueSoonFollowups.push(c.id);
      }

      const untouched = daysSinceLastTouch(c, referenceIso);
      if (untouched === null || untouched > staleDays) {
        staleContacts.push(c.id);
      }
    } else if (c.stage === "won") {
      wonValue += c.deal_value;
    }

    openTasksCount += c.tasks.filter((t) => !t.done).length;
    for (const rawTag of c.tags) {
      const key = rawTag.trim().toLowerCase();
      if (key) tagMap.set(key, (tagMap.get(key) ?? 0) + 1);
    }
  }

  const stages: StageSummary[] = STAGE_ORDER.map((stage) => {
    const b = stageBuckets.get(stage)!;
    return {
      stage,
      count: b.count,
      total_value: b.total_value,
      weighted_value: b.weighted_value,
      probability: STAGE_PROBABILITIES[stage],
    };
  });

  const tag_counts = Array.from(tagMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  return {
    total_contacts: contacts.length,
    open_deals: openDeals,
    total_pipeline_value: totalPipelineValue,
    weighted_pipeline_value: weightedPipelineValue,
    won_value: wonValue,
    overdue_followups: overdueFollowups,
    due_soon_followups: dueSoonFollowups,
    stale_contacts: staleContacts,
    open_tasks_count: openTasksCount,
    stages,
    tag_counts,
  };
}

export interface ContactFilterOptions {
  query?: string;
  stage?: PipelineStage | "all";
  tag?: string | "all";
}

export function filterAndSearchContacts(
  contacts: Contact[],
  options: ContactFilterOptions,
): Contact[] {
  const tokens = (options.query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const stageFilter = options.stage && options.stage !== "all" ? options.stage : null;
  const tagFilter = options.tag && options.tag !== "all" ? options.tag.toLowerCase() : null;

  const scored: Array<{ contact: Contact; score: number }> = [];

  for (const contact of contacts) {
    if (stageFilter && contact.stage !== stageFilter) continue;
    if (tagFilter && !contact.tags.some((t) => t.toLowerCase() === tagFilter)) continue;

    if (tokens.length === 0) {
      scored.push({ contact, score: 1 });
      continue;
    }

    const nameL = contact.name.toLowerCase();
    const companyL = contact.company.toLowerCase();
    const emailL = contact.email.toLowerCase();
    const roleL = contact.role.toLowerCase();
    const idL = contact.id.toLowerCase();
    const contextL = contact.context.toLowerCase();
    const tagsL = contact.tags.map((t) => t.toLowerCase());
    const timelineL = contact.timeline
      .map((t) => `${t.date} ${t.kind} ${t.note}`)
      .join(" ")
      .toLowerCase();
    const tasksL = contact.tasks.map((t) => t.text).join(" ").toLowerCase();

    let totalScore = 0;
    let matchedAll = true;
    for (const token of tokens) {
      let s = 0;
      if (nameL.includes(token)) s += nameL.startsWith(token) ? 14 : 10;
      if (companyL.includes(token)) s += 8;
      if (emailL.includes(token)) s += 7;
      if (tagsL.some((t) => t.includes(token))) s += 6;
      if (roleL.includes(token)) s += 5;
      if (idL.includes(token)) s += 4;
      if (contextL.includes(token)) s += 3;
      if (timelineL.includes(token)) s += 2;
      if (tasksL.includes(token)) s += 2;
      if (s === 0) {
        matchedAll = false;
        break;
      }
      totalScore += s;
    }

    if (matchedAll) {
      scored.push({ contact, score: totalScore });
    }
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.contact.deal_value - a.contact.deal_value ||
      a.contact.name.localeCompare(b.contact.name),
  );
  return scored.map((item) => item.contact);
}

export function formatCurrency(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount).toLocaleString("en-US")}`;
  }
}
