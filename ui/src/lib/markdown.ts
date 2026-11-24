import type { Contact, Interaction, ParseDiagnostic, PipelineStage, TaskItem } from "../types";

const VALID_STAGES = new Set<PipelineStage>([
  "lead",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
]);

const RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

export function validateContactId(id: string): void {
  if (!id || id.length > 96) {
    throw new Error("Contact id must be between 1 and 96 characters.");
  }
  if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
    throw new Error(`Contact id '${id}' contains forbidden path characters.`);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
    throw new Error(
      `Contact id '${id}' must start with a lowercase letter or digit and use only a-z, 0-9, '-', '_'.`,
    );
  }
  if (RESERVED_NAMES.has(id.toUpperCase())) {
    throw new Error(`Contact id '${id}' is a reserved filesystem name.`);
  }
}

export function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return cleaned || "contact";
}

function unquoteYaml(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner = trimmed.slice(1, -1);
    let out = "";
    for (let i = 0; i < inner.length; i += 1) {
      if (inner[i] === "\\" && i + 1 < inner.length) {
        const next = inner[i + 1];
        if (next === '"') out += '"';
        else if (next === "\\") out += "\\";
        else if (next === "n") out += "\n";
        else if (next === "t") out += "\t";
        else out += "\\" + next;
        i += 1;
      } else {
        out += inner[i];
      }
    }
    return out;
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function parseInlineList(raw: string): string[] {
  const trimmed = raw.trim();
  const inner =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;

  const items: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (const ch of inner) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && inDouble) {
      escaped = true;
      current += ch;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (ch === "," && !inSingle && !inDouble) {
      const value = unquoteYaml(current);
      if (value) items.push(value);
      current = "";
      continue;
    }
    current += ch;
  }

  const tail = unquoteYaml(current);
  if (tail) items.push(tail);
  return items;
}

function formatYamlScalar(value: string): string {
  if (!value) return '""';
  const lower = value.toLowerCase();
  const isKeyword = ["true", "false", "null", "~", "yes", "no", "on", "off"].includes(lower);
  const needsQuotes =
    isKeyword ||
    value.startsWith(" ") ||
    value.endsWith(" ") ||
    value.includes(": ") ||
    value.endsWith(":") ||
    value.includes(" #") ||
    value.startsWith("#") ||
    /[\n"'[\]{}]/.test(value) ||
    /^[@!*&|>?%`,]/.test(value);

  if (!needsQuotes) return value;

  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

export interface ParsedContactResult {
  contact: Contact;
  diagnostics: ParseDiagnostic[];
}

export function parseContactMarkdown(
  content: string,
  fallbackId: string,
  filePath: string,
): ParsedContactResult {
  const clean = content.startsWith("\ufeff") ? content.slice(1) : content;
  const lines = clean.replace(/\r\n/g, "\n").split("\n");
  const diagnostics: ParseDiagnostic[] = [];

  if (lines[0]?.trim() !== "---") {
    throw new Error(`${filePath}: missing opening YAML frontmatter delimiter '---'`);
  }

  let closingIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      closingIdx = i;
      break;
    }
  }
  if (closingIdx === -1) {
    throw new Error(`${filePath}: missing closing YAML frontmatter delimiter '---'`);
  }

  const scalars: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  let activeListKey: string | null = null;

  for (let i = 1; i < closingIdx; i += 1) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("- ") && activeListKey) {
      const val = unquoteYaml(trimmed.slice(2));
      if (val) {
        lists[activeListKey] = lists[activeListKey] || [];
        lists[activeListKey].push(val);
      }
      continue;
    }

    activeListKey = null;
    const colonIdx = rawLine.indexOf(":");
    if (colonIdx === -1) {
      diagnostics.push({
        file: filePath,
        line: i + 1,
        severity: "warning",
        message: `Ignoring malformed frontmatter line: '${trimmed}'`,
      });
      continue;
    }

    const key = rawLine.slice(0, colonIdx).trim().toLowerCase();
    const rawVal = rawLine.slice(colonIdx + 1).trim();
    if (!rawVal) {
      activeListKey = key;
      scalars[key] = "";
    } else if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
      lists[key] = parseInlineList(rawVal);
    } else {
      scalars[key] = unquoteYaml(rawVal);
    }
  }

  const id = (scalars.id || "").trim() || fallbackId;
  validateContactId(id);

  const name = (scalars.name || "").trim() || id;
  if (!(scalars.name || "").trim()) {
    diagnostics.push({
      file: filePath,
      line: 1,
      severity: "warning",
      message: "Missing 'name' in frontmatter; falling back to id.",
    });
  }

  const rawStage = (scalars.stage || "lead").trim().toLowerCase() as PipelineStage;
  let stage: PipelineStage = "lead";
  if (VALID_STAGES.has(rawStage)) {
    stage = rawStage;
  } else {
    diagnostics.push({
      file: filePath,
      line: null,
      severity: "warning",
      message: `Unknown stage '${scalars.stage}'; defaulting to 'lead'.`,
    });
  }

  let dealValue = 0;
  if (scalars.deal_value && scalars.deal_value.trim() !== "") {
    const parsedNum = Number(scalars.deal_value.replace(/[,$ ]/g, ""));
    if (Number.isFinite(parsedNum) && parsedNum >= 0) {
      dealValue = parsedNum;
    } else {
      diagnostics.push({
        file: filePath,
        line: null,
        severity: "warning",
        message: `Invalid deal_value '${scalars.deal_value}'; defaulting to 0.`,
      });
    }
  }

  const currency = (scalars.currency || "USD").trim().toUpperCase() || "USD";
  const rawFollowup = (scalars.next_followup || "").trim();
  const nextFollowup =
    rawFollowup && rawFollowup !== "null" && rawFollowup !== "~" ? rawFollowup : null;

  const tags = lists.tags ?? (scalars.tags ? parseInlineList(scalars.tags) : []);

  let section: "none" | "context" | "timeline" | "tasks" = "none";
  const contextLines: string[] = [];
  const timeline: Interaction[] = [];
  const tasks: TaskItem[] = [];

  for (let i = closingIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("## ")) {
      const heading = trimmed.slice(3).trim().toLowerCase();
      if (heading === "context" || heading === "notes") {
        section = "context";
        continue;
      }
      if (heading === "timeline" || heading === "interactions" || heading === "activity") {
        section = "timeline";
        continue;
      }
      if (heading === "tasks" || heading === "next steps" || heading === "todos") {
        section = "tasks";
        continue;
      }
      if (section === "context") contextLines.push(line);
      continue;
    }

    if (section === "none") {
      if (trimmed) {
        section = "context";
        contextLines.push(line);
      }
    } else if (section === "context") {
      contextLines.push(line);
    } else if (section === "timeline") {
      if (!trimmed) continue;
      if (trimmed.startsWith("- ")) {
        const rest = trimmed.slice(2);
        const firstPipe = rest.indexOf("|");
        const secondPipe = firstPipe >= 0 ? rest.indexOf("|", firstPipe + 1) : -1;
        if (firstPipe > 0 && secondPipe > firstPipe) {
          timeline.push({
            date: rest.slice(0, firstPipe).trim(),
            kind: rest.slice(firstPipe + 1, secondPipe).trim().toLowerCase(),
            note: rest.slice(secondPipe + 1).trim(),
          });
        } else {
          diagnostics.push({
            file: filePath,
            line: i + 1,
            severity: "warning",
            message: `Malformed timeline entry '${trimmed}'`,
          });
        }
      }
    } else if (section === "tasks") {
      if (!trimmed) continue;
      if (trimmed.startsWith("- [ ] ")) {
        tasks.push({ done: false, text: trimmed.slice(6).trim() });
      } else if (trimmed.startsWith("- [x] ") || trimmed.startsWith("- [X] ")) {
        tasks.push({ done: true, text: trimmed.slice(6).trim() });
      } else if (trimmed.startsWith("- ")) {
        tasks.push({ done: false, text: trimmed.slice(2).trim() });
      }
    }
  }

  while (contextLines.length > 0 && contextLines[0].trim() === "") contextLines.shift();
  while (contextLines.length > 0 && contextLines[contextLines.length - 1].trim() === "") {
    contextLines.pop();
  }

  return {
    contact: {
      id,
      name,
      email: scalars.email || "",
      company: scalars.company || "",
      role: scalars.role || "",
      stage,
      deal_value: dealValue,
      currency,
      next_followup: nextFollowup,
      tags,
      owner: (scalars.owner || "").trim() || "founder",
      website: scalars.website || "",
      phone: scalars.phone || "",
      context: contextLines.join("\n"),
      timeline,
      tasks,
      file_path: filePath,
    },
    diagnostics,
  };
}

export function serializeContact(contact: Contact): string {
  validateContactId(contact.id);

  const dealVal = Math.max(0, contact.deal_value);
  const formattedDeal =
    Math.abs(dealVal - Math.round(dealVal)) < 1e-6
      ? String(Math.round(dealVal))
      : dealVal.toFixed(2);
  const formattedTags = contact.tags
    .map((t) => t.trim())
    .filter(Boolean)
    .map(formatYamlScalar)
    .join(", ");

  const lines = [
    "---",
    `id: ${contact.id}`,
    `name: ${formatYamlScalar(contact.name)}`,
    `email: ${formatYamlScalar(contact.email)}`,
    `company: ${formatYamlScalar(contact.company)}`,
    `role: ${formatYamlScalar(contact.role)}`,
    `stage: ${contact.stage}`,
    `deal_value: ${formattedDeal}`,
    `currency: ${(contact.currency || "USD").trim().toUpperCase()}`,
    `next_followup: ${contact.next_followup ? contact.next_followup.trim() : '""'}`,
    `tags: [${formattedTags}]`,
    `owner: ${formatYamlScalar((contact.owner || "founder").trim())}`,
    `website: ${formatYamlScalar(contact.website)}`,
    `phone: ${formatYamlScalar(contact.phone)}`,
    "---",
    "",
    "## Context",
  ];

  if (contact.context.trim()) {
    lines.push(contact.context.trim());
  }
  lines.push("");
  lines.push("## Timeline");

  for (const item of contact.timeline) {
    const safeNote = item.note.replace(/\r?\n/g, " ").trim();
    const safeKind = (item.kind || "note").trim().toLowerCase();
    lines.push(`- ${item.date.trim()} | ${safeKind} | ${safeNote}`);
  }

  lines.push("");
  lines.push("## Tasks");
  for (const task of contact.tasks) {
    const safeText = task.text.replace(/\r?\n/g, " ").trim();
    lines.push(`- [${task.done ? "x" : " "}] ${safeText}`);
  }

  return lines.join("\n") + "\n";
}

export function sanitizeCsvField(raw: string): string {
  const trimmedStart = raw.replace(/^[ \t]+/, "");
  const isFormula =
    /^[=+\-@\t\r]/.test(raw) || /^[=+\-@]/.test(trimmedStart);
  const neutralized = isFormula ? `'${raw}` : raw;
  if (/[,"\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

export function exportContactsCsv(contacts: Contact[]): string {
  const header =
    "id,name,email,company,role,stage,deal_value,currency,next_followup,tags,owner,website,phone,last_contacted,open_tasks";
  const rows = contacts.map((c) => {
    const lastContacted = c.timeline.map((t) => t.date).sort().at(-1) ?? "";
    const openTasks = c.tasks.filter((t) => !t.done).length;
    const dealStr =
      Math.abs(c.deal_value - Math.round(c.deal_value)) < 1e-6
        ? String(Math.round(c.deal_value))
        : c.deal_value.toFixed(2);
    return [
      sanitizeCsvField(c.id),
      sanitizeCsvField(c.name),
      sanitizeCsvField(c.email),
      sanitizeCsvField(c.company),
      sanitizeCsvField(c.role),
      sanitizeCsvField(c.stage),
      dealStr,
      sanitizeCsvField(c.currency),
      sanitizeCsvField(c.next_followup ?? ""),
      sanitizeCsvField(c.tags.join("; ")),
      sanitizeCsvField(c.owner),
      sanitizeCsvField(c.website),
      sanitizeCsvField(c.phone),
      sanitizeCsvField(lastContacted),
      String(openTasks),
    ].join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}

function escapeVcard(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function exportContactsVcard(contacts: Contact[]): string {
  return contacts
    .map((c) => {
      const parts = c.name.trim().split(/\s+/).filter(Boolean);
      const first = parts[0] ?? "";
      const last = parts.length > 1 ? parts[parts.length - 1] : "";
      const lines = [
        "BEGIN:VCARD",
        "VERSION:4.0",
        `UID:urn:folklore:${escapeVcard(c.id)}`,
        `FN:${escapeVcard(c.name)}`,
        `N:${escapeVcard(last)};${escapeVcard(first)};;;`,
      ];
      if (c.company) lines.push(`ORG:${escapeVcard(c.company)}`);
      if (c.role) lines.push(`TITLE:${escapeVcard(c.role)}`);
      if (c.email) lines.push(`EMAIL;TYPE=work:${escapeVcard(c.email)}`);
      if (c.phone) lines.push(`TEL;TYPE=work:${escapeVcard(c.phone)}`);
      if (c.website) lines.push(`URL:${escapeVcard(c.website)}`);
      if (c.tags.length > 0) {
        lines.push(`CATEGORIES:${c.tags.map(escapeVcard).join(",")}`);
      }
      const note = [
        `Stage: ${c.stage} | Deal: ${c.currency} ${Math.round(c.deal_value)}`,
        c.context.trim(),
      ]
        .filter(Boolean)
        .join("\n");
      lines.push(`NOTE:${escapeVcard(note)}`);
      lines.push("END:VCARD");
      return lines.join("\r\n") + "\r\n";
    })
    .join("");
}
