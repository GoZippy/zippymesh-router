#!/usr/bin/env node
/**
 * Validates that the current tree does NOT contain proprietary paths.
 * Use before pushing to the open-core repo (zippymesh-router) or before making it public.
 *
 * Proprietary paths (from OPEN_CORE_MANIFEST.md and obfuscate.cjs):
 *   - src/lib/routing/engine.js
 *   - src/lib/sidecar.js
 *   - open-sse/translator/ (any file under this dir)
 *   - open-sse/handlers/chatCore.js
 *
 * Exit 0: no proprietary paths present (safe for open-core).
 * Exit 1: one or more proprietary paths found (do not publish as open-core).
 *
 * Usage: node scripts/validate-open-core.cjs [--allow-stubs]
 *   --allow-stubs: treat presence of path as OK if file contains "STUB" or "open-core placeholder"
 */

const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");

const PROPRIETARY_PATHS = [
  "src/lib/routing/engine.js",
  "src/lib/sidecar.js",
  "open-sse/handlers/chatCore.js",
];

const PROPRIETARY_DIRS = [
  "open-sse/translator",
];

function listFilesUnder(dirRel) {
  const full = path.join(ROOT, dirRel);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (!stat.isDirectory()) return stat.isFile() ? [dirRel] : [];
  const out = [];
  for (const name of fs.readdirSync(full)) {
    const sub = path.join(dirRel, name);
    const subFull = path.join(ROOT, sub);
    if (fs.statSync(subFull).isDirectory()) {
      out.push(...listFilesUnder(sub));
    } else {
      out.push(sub);
    }
  }
  return out;
}

const allowStubs = process.argv.includes("--allow-stubs");

function isStub(filePath) {
  const full = path.join(ROOT, filePath);
  if (!fs.existsSync(full)) return false;
  const content = fs.readFileSync(full, "utf8");
  return /STUB|open-core placeholder|proprietary code removed/i.test(content);
}

const found = [];

for (const p of PROPRIETARY_PATHS) {
  const full = path.join(ROOT, p);
  if (fs.existsSync(full)) {
    if (allowStubs && isStub(p)) continue;
    found.push(p);
  }
}

for (const d of PROPRIETARY_DIRS) {
  const files = listFilesUnder(d);
  for (const f of files) {
    if (allowStubs && isStub(f)) continue;
    found.push(f);
  }
}

if (found.length > 0) {
  console.error("validate-open-core: proprietary paths found (do not use this tree for public open-core repo):");
  found.forEach((p) => console.error("  -", p));
  process.exit(1);
}

console.log("validate-open-core: OK — no proprietary paths present. Safe for open-core.");
process.exit(0);
