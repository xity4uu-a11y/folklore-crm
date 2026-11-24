#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const pluginsDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repoRoot, "plugins");
const schemaPath = path.join(pluginsDir, "schema.json");

if (!fs.existsSync(schemaPath)) {
  console.error(`FAIL  Missing schema file: ${schemaPath}`);
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const requiredFields = schema.required || [];
const allowedKeys = new Set(Object.keys(schema.properties || {}));
const allowedKinds = new Set(schema.properties?.kind?.enum || []);
const idRegex = new RegExp(schema.properties?.id?.pattern || "^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$");
const semverRegex = new RegExp(schema.properties?.version?.pattern || "^[0-9]+\\.[0-9]+\\.[0-9]+$");

const files = fs
  .readdirSync(pluginsDir)
  .filter((name) => name.endsWith(".json") && name !== "schema.json")
  .sort();

let passed = 0;
let failed = 0;
const seenIds = new Set();

for (const file of files) {
  const fullPath = path.join(pluginsDir, file);
  const errors = [];
  let manifest;

  try {
    manifest = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (err) {
    console.error(`FAIL  ${file}: invalid JSON (${err.message})`);
    failed += 1;
    continue;
  }

  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    console.error(`FAIL  ${file}: root must be a JSON object`);
    failed += 1;
    continue;
  }

  for (const field of requiredFields) {
    if (!(field in manifest)) {
      errors.push(`missing required field '${field}'`);
    }
  }

  for (const key of Object.keys(manifest)) {
    if (!allowedKeys.has(key)) {
      errors.push(`unexpected property '${key}'`);
    }
  }

  if (typeof manifest.id !== "string" || !idRegex.test(manifest.id)) {
    errors.push(`invalid id '${manifest.id}'`);
  } else if (seenIds.has(manifest.id)) {
    errors.push(`duplicate plugin id '${manifest.id}'`);
  } else {
    seenIds.add(manifest.id);
  }

  if (typeof manifest.name !== "string" || manifest.name.trim().length < 1 || manifest.name.length > 80) {
    errors.push("name must be 1..80 chars");
  }

  if (typeof manifest.version !== "string" || !semverRegex.test(manifest.version)) {
    errors.push(`invalid semver '${manifest.version}'`);
  }

  if (typeof manifest.kind !== "string" || !allowedKinds.has(manifest.kind)) {
    errors.push(`invalid kind '${manifest.kind}'`);
  }

  if (
    typeof manifest.description !== "string" ||
    manifest.description.trim().length < 10 ||
    manifest.description.trim().length > 280
  ) {
    errors.push("description must be 10..280 chars");
  }

  if (typeof manifest.author !== "string" || manifest.author.trim().length < 1) {
    errors.push("author must be a non-empty string");
  }

  if (typeof manifest.enabled !== "boolean") {
    errors.push("enabled must be boolean");
  }

  if (typeof manifest.config !== "object" || manifest.config === null || Array.isArray(manifest.config)) {
    errors.push("config must be a JSON object");
  }

  if (errors.length === 0) {
    console.log(`PASS  ${file} (${manifest.id} v${manifest.version} [${manifest.kind}])`);
    passed += 1;
  } else {
    console.error(`FAIL  ${file}: ${errors.join("; ")}`);
    failed += 1;
  }
}

console.log(`\nPlugin validation summary: ${passed}/${passed + failed} PASS`);
if (failed > 0 || passed === 0) {
  process.exit(1);
}
