import { describe, expect, it } from "vitest";
import {
  exportContactsCsv,
  exportContactsVcard,
  parseContactMarkdown,
  serializeContact,
  slugify,
  validateContactId,
} from "../lib/markdown";
import { SEED_CONTACTS } from "../lib/seedVault";
import type { Contact } from "../types";

describe("markdown frontmatter parser & serializer", () => {
  it("performs lossless round-trip serialization on rich contacts", () => {
    const original: Contact = {
      ...SEED_CONTACTS[0],
      company: "Northstar Systems: Security",
      tags: ["enterprise", "security", "founder-led"],
    };

    const md = serializeContact(original);
    const { contact, diagnostics } = parseContactMarkdown(
      md,
      original.id,
      original.file_path,
    );

    expect(diagnostics).toHaveLength(0);
    expect(contact).toEqual(original);
    expect(serializeContact(contact)).toBe(md);
  });

  it("parses Windows CRLF line endings and block YAML lists", () => {
    const raw = [
      "---",
      "id: ada-lovelace",
      'name: "Ada Lovelace"',
      "email: ada@analytical.io",
      "company: Analytical Engines",
      "role: Chief Architect",
      "stage: negotiation",
      "deal_value: 32500.50",
      "currency: usd",
      "next_followup: 2026-12-10",
      "tags:",
      "  - enterprise",
      "  - math",
      "owner: founder",
      "website: https://analytical.io",
      "phone: +44-20-7946-0111",
      "---",
      "",
      "## Context",
      "Evaluating local-first CRM vault.",
      "",
      "## Timeline",
      "- 2026-11-21 | call | Discussed deterministic Git diffs.",
      "",
      "## Tasks",
      "- [X] Share CLI binary",
      "- [ ] Finalize enterprise support scope",
    ].join("\r\n");

    const { contact, diagnostics } = parseContactMarkdown(
      raw,
      "fallback",
      "contacts/ada-lovelace.md",
    );

    expect(diagnostics).toHaveLength(0);
    expect(contact.id).toBe("ada-lovelace");
    expect(contact.stage).toBe("negotiation");
    expect(contact.deal_value).toBe(32500.5);
    expect(contact.currency).toBe("USD");
    expect(contact.tags).toEqual(["enterprise", "math"]);
    expect(contact.tasks).toEqual([
      { done: true, text: "Share CLI binary" },
      { done: false, text: "Finalize enterprise support scope" },
    ]);
  });

  it("rejects path traversal and unsafe contact IDs", () => {
    const unsafe = [
      "",
      "../etc/passwd",
      "nested/path",
      "win\\slash",
      "null\0byte",
      ".hidden",
      "-flag",
      "CON",
      "Has Space",
    ];
    for (const id of unsafe) {
      expect(() => validateContactId(id)).toThrow();
    }
    expect(() => validateContactId("elena-rostova")).not.toThrow();
    expect(slugify("Elena Rostova (VP)")).toBe("elena-rostova-vp");
  });

  it("neutralizes spreadsheet formula injection in CSV export", () => {
    const hostile: Contact = {
      ...SEED_CONTACTS[0],
      id: "hostile-lead",
      name: "=CMD|' /C calc'!A0",
      company: "-2+3, Corp",
      phone: "+1-415-555-0142",
      tags: ["@SUM(A1:A2)"],
    };

    const csv = exportContactsCsv([hostile]);
    expect(csv).toContain("'=CMD|' /C calc'!A0");
    expect(csv).toContain(`"'-2+3, Corp"`);
    expect(csv).toContain("'+1-415-555-0142");
    expect(csv).toContain("'@SUM(A1:A2)");
  });

  it("exports valid RFC 6350 vCard 4.0 blocks", () => {
    const vcf = exportContactsVcard([SEED_CONTACTS[0]]);
    expect(vcf.startsWith("BEGIN:VCARD\r\nVERSION:4.0\r\n")).toBe(true);
    expect(vcf).toContain("UID:urn:folklore:elena-rostova\r\n");
    expect(vcf).toContain("FN:Elena Rostova\r\n");
    expect(vcf).toContain("N:Rostova;Elena;;;\r\n");
    expect(vcf).toContain("CATEGORIES:enterprise,security,founder-led\r\n");
    expect(vcf.endsWith("END:VCARD\r\n")).toBe(true);
  });
});
