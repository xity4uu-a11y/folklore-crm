# Contributing to Folklore CRM

Thank you for helping keep customer relationship data plain-text, local-first, and free from per-seat SaaS rent.

---

## Local Development Setup

### Prerequisites
- Rust stable toolchain (`rustc`, `cargo`, `clippy`)
- Local `git` in `PATH`
- Node.js 20+ and npm (for UI tests, build, and plugin schema validation)

### Running the Full Test Suite

```bash
# 1. Pure-Rust core unit tests & real local Git integration tests
cargo test -p folklore-core -- --nocapture

# 2. Strict Rust linter (0 warnings allowed)
cargo clippy -p folklore-core --all-targets -- -D warnings

# 3. Validate all community plugin manifests (both Rust CLI and Node script)
cargo run -p folklore-core -- validate-plugins --dir plugins
node scripts/validate-plugins.mjs

# 4. React 19 + TypeScript UI typecheck, Vitest unit tests, and Vite production build
cd ui
npm install
npm run typecheck
npm test
npm run build
```

---

## Submitting a Community Plugin (25-Line JSON Template)

Community plugins live in `plugins/<plugin-id>.json` and must strictly conform to `plugins/schema.json`. Allowed `kind` values: `pipeline`, `radar`, `importer`, `snippets`, `exporter`, `automation`.

Copy this exact 25-line template into `plugins/your-plugin-id.json`:

```json
{
  "id": "founder-investor-updates",
  "name": "Founder Investor Updates",
  "version": "1.0.0",
  "kind": "snippets",
  "description": "Generates monthly plain-text investor update digests from won deals and weighted pipeline metrics.",
  "author": "your-github-handle",
  "enabled": true,
  "config": {
    "cadence_days": 30,
    "include_stages": [
      "proposal",
      "negotiation",
      "won"
    ],
    "tag_filter": "investor",
    "output_file": "reports/monthly-update.md",
    "commit_on_generate": false,
    "metrics": [
      "weighted_pipeline_value",
      "won_value"
    ]
  }
}
```

Then validate your manifest before opening a pull request:

```bash
node scripts/validate-plugins.mjs
cargo run -p folklore-core -- validate-plugins --dir plugins
```

---

## Pull Request Checklist

- [ ] `cargo test -p folklore-core` passes with zero failures.
- [ ] `cargo clippy -p folklore-core --all-targets -- -D warnings` passes with zero warnings.
- [ ] `npm run typecheck`, `npm test`, and `npm run build` in `ui/` pass with zero errors.
- [ ] `node scripts/validate-plugins.mjs` reports 100% PASS for all plugin manifests.
- [ ] No external cloud telemetry, secrets, emojis, or neon visual clutter introduced.
- [ ] Plain-text Markdown serialization remains deterministic and Git-diff friendly.
- [ ] Any path or Git ref inputs enforce strict validation against path traversal and argument injection.
