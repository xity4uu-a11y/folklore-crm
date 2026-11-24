import type { Contact, PluginManifest } from "../types";

export const SEED_CONTACTS: Contact[] = [
  {
    id: "elena-rostova",
    name: "Elena Rostova",
    email: "elena@northstar.dev",
    company: "Northstar Systems",
    role: "VP of Engineering",
    stage: "proposal",
    deal_value: 24000,
    currency: "USD",
    next_followup: "2026-12-01",
    tags: ["enterprise", "security", "founder-led"],
    owner: "founder",
    website: "https://northstar.dev",
    phone: "+1-415-555-0142",
    context:
      "Replacing 45 HubSpot Enterprise seats ($2,250/mo) with a local-first plain-text vault.\nSecurity team requires full Git commit provenance for every account edit and zero external cloud sync.",
    timeline: [
      {
        date: "2026-11-22",
        kind: "call",
        note: "Reviewed Git rollback workflow and VS Code live-sync latency (<150ms).",
      },
      {
        date: "2026-11-14",
        kind: "email",
        note: "Delivered SOC2 self-hosted architecture brief and TCO spreadsheet.",
      },
      {
        date: "2026-11-04",
        kind: "demo",
        note: "Live walkthrough of Folklore CLI exports and Kanban pipeline forecasting.",
      },
    ],
    tasks: [
      { done: false, text: "Send annual enterprise support SLA redlines" },
      { done: true, text: "Share deterministic SHA-256 vault sync specification" },
      { done: true, text: "Export legacy HubSpot CSV and run migration script" },
    ],
    file_path: "contacts/elena-rostova.md",
  },
  {
    id: "marcus-chen",
    name: "Marcus Chen",
    email: "marcus@foundrylabs.io",
    company: "Foundry Labs",
    role: "Co-Founder & CTO",
    stage: "negotiation",
    deal_value: 18500,
    currency: "USD",
    next_followup: "2026-11-28",
    tags: ["developer-tools", "inbound", "git-native"],
    owner: "founder",
    website: "https://foundrylabs.io",
    phone: "+1-212-555-0199",
    context:
      "Engineering-led team of 18 leaving Pipedrive due to brittle API rate limits and seat inflation.\nPlans to store contacts/*.md inside their private monorepo with branch protection on main.",
    timeline: [
      {
        date: "2026-11-20",
        kind: "demo",
        note: "Confirmed folklore commit and folklore history fit their PR workflow.",
      },
      {
        date: "2026-11-11",
        kind: "call",
        note: "Scoped custom B2B SaaS pipeline probabilities and CI validation hook.",
      },
    ],
    tasks: [
      { done: false, text: "Confirm onboarding workshop schedule with engineering leads" },
      { done: true, text: "Validate folklore validate-plugins inside GitHub Actions" },
    ],
    file_path: "contacts/marcus-chen.md",
  },
  {
    id: "priya-nair",
    name: "Priya Nair",
    email: "priya@meridiancloud.co",
    company: "Meridian Cloud",
    role: "Head of Partnerships",
    stage: "qualified",
    deal_value: 12000,
    currency: "USD",
    next_followup: "2026-12-05",
    tags: ["partnerships", "self-hosted", "europe"],
    owner: "founder",
    website: "https://meridiancloud.co",
    phone: "+44-20-7946-0912",
    context:
      "Managing 35 infrastructure consultancy partners across London and Berlin.\nNeeds instant vCard .vcf exports for executive travel and zero GDPR cloud transfer headaches.",
    timeline: [
      {
        date: "2026-11-16",
        kind: "meeting",
        note: "Mapped partner tiers to Markdown tags and quarterly review tasks.",
      },
      {
        date: "2026-11-02",
        kind: "email",
        note: "Shared Folklore CRM comparison against Attio and Clay.",
      },
    ],
    tasks: [
      { done: false, text: "Prepare partner directory starter template in Markdown" },
      { done: false, text: "Schedule technical review with legal compliance lead" },
    ],
    file_path: "contacts/priya-nair.md",
  },
  {
    id: "tomasz-kowalski",
    name: "Tomasz Kowalski",
    email: "tomasz@veritas-sec.pl",
    company: "Veritas Security",
    role: "Principal Consultant",
    stage: "won",
    deal_value: 9600,
    currency: "USD",
    next_followup: null,
    tags: ["security", "advisory", "case-study"],
    owner: "founder",
    website: "https://veritas-sec.pl",
    phone: "+48-22-555-0188",
    context:
      "Air-gapped penetration testing consultancy running 100% offline vaults synced via signed Git bundles.\nAgreed to publish an engineering testimonial after Q4 rollout.",
    timeline: [
      {
        date: "2026-11-10",
        kind: "call",
        note: "Signed annual advisory support agreement; deployed standalone Rust CLI binary.",
      },
      {
        date: "2026-10-29",
        kind: "email",
        note: "Verified zero outbound network calls during offline packet capture.",
      },
    ],
    tasks: [
      { done: true, text: "Provision release checksums and reproducible build instructions" },
      { done: false, text: "Draft Q1 engineering case study outline" },
    ],
    file_path: "contacts/tomasz-kowalski.md",
  },
  {
    id: "hannah-lindqvist",
    name: "Hannah Lindqvist",
    email: "hannah@nordicgrid.se",
    company: "NordicGrid Energy",
    role: "Director of Operations",
    stage: "lead",
    deal_value: 15000,
    currency: "USD",
    next_followup: "2026-11-18",
    tags: ["energy", "stale-watch", "outbound"],
    owner: "founder",
    website: "https://nordicgrid.se",
    phone: "+46-8-555-0174",
    context:
      "Initial referral from Stockholm founder network exploring lightweight account tracking for industrial hardware partners.\nThread has been quiet for over two weeks; flagged automatically by Stale Relationship Radar.",
    timeline: [
      {
        date: "2026-10-28",
        kind: "email",
        note: "Sent plain-text vault demo video and two-minute quickstart guide.",
      },
    ],
    tasks: [
      { done: false, text: "Send concise follow-up check-in using cold-outreach-snippets template" },
    ],
    file_path: "contacts/hannah-lindqvist.md",
  },
  {
    id: "david-okafor",
    name: "David Okafor",
    email: "david@latticeworks.ai",
    company: "LatticeWorks",
    role: "Head of Revenue Operations",
    stage: "proposal",
    deal_value: 21000,
    currency: "USD",
    next_followup: "2026-11-26",
    tags: ["enterprise", "revops", "migration"],
    owner: "founder",
    website: "https://latticeworks.ai",
    phone: "+1-646-555-0131",
    context:
      "Consolidating scattered Notion databases and Clay exports into a single Git-audited repository.\nValues deterministic Markdown diffs during weekly pipeline reviews.",
    timeline: [
      {
        date: "2026-11-19",
        kind: "call",
        note: "Reviewed weighted pipeline math and custom stage probability plugin.",
      },
      {
        date: "2026-11-05",
        kind: "email",
        note: "Confirmed zero per-seat pricing for 22 internal collaborators.",
      },
    ],
    tasks: [
      { done: false, text: "Run formula-safe CSV import dry-run on 400 sample accounts" },
    ],
    file_path: "contacts/david-okafor.md",
  },
];

export const SEED_PLUGINS: PluginManifest[] = [
  {
    id: "b2b-saas-pipeline",
    name: "B2B SaaS Weighted Pipeline",
    version: "1.0.0",
    kind: "pipeline",
    description:
      "Configures stage close probabilities, weighted ARR forecasting, and target cycle-time guardrails for founder-led B2B SaaS sales.",
    author: "xity4uu-a11y",
    enabled: true,
    source_file: "b2b-saas-pipeline.json",
    config: {
      currency: "USD",
      target_cycle_days: 30,
      require_next_followup_on_open_deals: true,
    },
  },
  {
    id: "stale-relationship-radar",
    name: "Stale Relationship Radar",
    version: "1.0.0",
    kind: "radar",
    description:
      "Surfaces open opportunities and VIP contacts with zero recorded touchpoints in the past 14 days so high-value threads never go cold.",
    author: "xity4uu-a11y",
    enabled: true,
    source_file: "stale-relationship-radar.json",
    config: {
      stale_threshold_days: 14,
      due_soon_window_days: 7,
      priority_tags: ["enterprise", "founder-led", "vip"],
    },
  },
  {
    id: "meeting-notes-importer",
    name: "Markdown Meeting Notes Importer",
    version: "1.0.0",
    kind: "importer",
    description:
      "Maps local Obsidian or VS Code meeting notes into timestamped ## Timeline entries and unchecked ## Tasks action items.",
    author: "xity4uu-a11y",
    enabled: true,
    source_file: "meeting-notes-importer.json",
    config: {
      source_glob: "notes/meetings/*.md",
      timeline_kind: "meeting",
      extract_action_items: true,
    },
  },
  {
    id: "cold-outreach-snippets",
    name: "Cold Outreach Plain-Text Snippets",
    version: "1.0.0",
    kind: "snippets",
    description:
      "Provides reusable Markdown follow-up templates parameterized with frontmatter fields for zero-bloat founder outreach.",
    author: "xity4uu-a11y",
    enabled: true,
    source_file: "cold-outreach-snippets.json",
    config: {
      templates_count: 2,
      default_format: "markdown",
    },
  },
  {
    id: "vcard-csv-portable-export",
    name: "Portable vCard & Formula-Safe CSV Export",
    version: "1.0.0",
    kind: "exporter",
    description:
      "Guarantees 1-click escape from Folklore CRM via RFC 6350 vCard 4.0 and OWASP formula-neutralized CSV archives.",
    author: "xity4uu-a11y",
    enabled: true,
    source_file: "vcard-csv-portable-export.json",
    config: {
      formats: ["csv", "vcf"],
      neutralize_csv_formulas: true,
      vcard_version: "4.0",
    },
  },
];
