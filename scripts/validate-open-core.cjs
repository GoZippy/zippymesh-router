#!/usr/bin/env node
/**
 * validate-open-core.cjs
 *
 * Validates that none of the proprietary paths from OPEN_CORE_MANIFEST.md exist
 * in the current working directory (or are already stubbed).
 *
 * Usage:
 *   node scripts/validate-open-core.cjs             # fail if proprietary paths found
 *   node scripts/validate-open-core.cjs --allow-stubs  # pass if stubs are present
 *
 * Exit 0 = safe to publish as open-core.
 * Exit 1 = proprietary files detected.
 */

const fs   = require("fs");
const path = require("path");

const ROOT         = process.cwd();
const ALLOW_STUBS  = process.argv.includes("--allow-stubs");

// Paths that must NOT appear in the open-core public repo
// (from docs/OPEN_CORE_MANIFEST.md)
const PROPRIETARY_PATHS = [
  "src/lib/routing/engine.js",
  "src/lib/sidecar.js",
  "open-sse/translator",
  "open-sse/handlers/chatCore.js",
];

// Stub marker — if a file contains this string, it's considered a stub (not proprietary)
const STUB_MARKER = "OPEN_CORE_STUB";

let violations = 0;

for (const rel of PROPRIETARY_PATHS) {
  const abs = path.join(ROOT, rel);

  const isDir  = !rel.includes(".");
  const exists = isDir ? fs.existsSync(abs) && fs.statSync(abs).isDirectory()
                       : fs.existsSync(abs);

  if (!exists) continue;

  if (ALLOW_STUBS && !isDir) {
    const content = fs.readFileSync(abs, "utf8");
    if (content.includes(STUB_MARKER)) {
      console.log(`  [stub]  ${rel}`);
      continue;
    }
  }

  // For directories: check if all .js files inside contain the stub marker
  if (ALLOW_STUBS && isDir) {
    const jsFiles = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".js")) jsFiles.push(full);
      }
    };
    walk(abs);
    const allStubbed = jsFiles.length > 0 && jsFiles.every(f =>
      fs.readFileSync(f, "utf8").includes(STUB_MARKER)
    );
    if (allStubbed) {
      console.log(`  [stub]  ${rel}/ (${jsFiles.length} files, all stubbed)`);
      continue;
    }
  }

  console.error(`  [FAIL]  ${rel} — proprietary file present in open-core tree`);
  violations++;
}

if (violations === 0) {
  console.log("validate-open-core: PASS — no proprietary paths detected");
  process.exit(0);
} else {
  console.error(`\nvalidate-open-core: FAIL — ${violations} proprietary path(s) detected`);
  console.error("Run the community build script first: bash scripts/build-community.sh");
  process.exit(1);
}
