#!/usr/bin/env node
/**
 * Overwrite proprietary paths with stubs (open-core placeholder).
 * Run on the open-core branch before pushing to zippymesh-router.
 * Full source remains in zippymesh-dist.
 */
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");

const STUB_JS = `// open-core placeholder — proprietary code in private repo zippymesh-dist
// See docs/OPEN_CORE_MANIFEST.md
module.exports = {};
`;

const STUB_ESM = `// open-core placeholder — proprietary code in private repo zippymesh-dist
// See docs/OPEN_CORE_MANIFEST.md
export default {};
export function noop() { return Promise.resolve(); }
`;

const FILES = [
  "src/lib/routing/engine.js",
  "src/lib/sidecar.js",
  "open-sse/handlers/chatCore.js",
];

function listJs(dirRel) {
  const full = path.join(ROOT, dirRel);
  if (!fs.existsSync(full)) return [];
  const out = [];
  for (const name of fs.readdirSync(full)) {
    const sub = path.join(dirRel, name);
    const subFull = path.join(ROOT, sub);
    if (fs.statSync(subFull).isDirectory()) {
      out.push(...listJs(sub));
    } else if (sub.endsWith(".js")) {
      out.push(sub);
    }
  }
  return out;
}

const translatorFiles = listJs("open-sse/translator");
const all = [...FILES, ...translatorFiles];

for (const rel of all) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const content = rel.startsWith("open-sse/") ? STUB_ESM : STUB_JS;
  fs.writeFileSync(full, content, "utf8");
  console.log("Stubbed:", rel);
}

console.log("Done. Run: npm run validate-open-core -- --allow-stubs");
