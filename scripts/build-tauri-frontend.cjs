#!/usr/bin/env node
/**
 * Tauri desktop build helper.
 *
 * Builds Next.js in `standalone` output mode (the default — server-rendered,
 * not static export). The Tauri app spawns the compiled standalone server as a
 * sidecar binary ("zippy-node") and loads http://localhost:20128 in its WebView.
 *
 * Run via: npm run build:tauri-frontend
 * Called by: tauri.conf.json beforeBuildCommand
 *
 * SECURITY — why the copy below is filtered and then re-scanned (adversarial
 * review 2026-08-30, item 16e): this script used to `fs.cpSync(.next/standalone
 * -> src-tauri/resources/standalone)` wholesale, and `next build` copies the
 * repo-root `.env` into `.next/standalone/.env`. tauri.conf.json bundles
 * `resources/standalone/**` — so the installer would carry the builder's `.env`,
 * and a CI build (whose `prebuild` mints a fresh one) would bake ONE shared
 * JWT_SECRET into every copy of it. See scripts/lib/bundleFilter.cjs.
 *
 * No Tauri installer has ever been published, so nothing has leaked. This is
 * the gate that has to exist before the first one does.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { copyFiltered, findLeakedNames } = require("./lib/bundleFilter.cjs");

const root = path.join(__dirname, "..");
const standaloneDir = path.join(root, ".next", "standalone");
const resourcesDest = path.join(root, "src-tauri", "resources", "standalone");

// Standalone mode is the default when IS_TAURI is NOT set.
// We explicitly unset it in case a parent shell had it set.
const env = { ...process.env };
delete env.IS_TAURI;

execSync("node ./secrets-check.cjs && node scripts/build.cjs", {
  stdio: "inherit",
  cwd: root,
  env,
});

// Copy the standalone output into Tauri's resource bundle.
// lib.rs will pass ZIPPY_STANDALONE_DIR pointing here when spawning the sidecar.
console.log("[build-tauri-frontend] Copying .next/standalone → src-tauri/resources/standalone (filtered) ...");
if (fs.existsSync(resourcesDest)) {
  // Also purges any secret a PREVIOUS unfiltered build left behind.
  fs.rmSync(resourcesDest, { recursive: true, force: true });
}
const stats = copyFiltered(standaloneDir, resourcesDest, (m) =>
  console.log(`[build-tauri-frontend] ${m}`)
);
console.log(
  `[build-tauri-frontend] Copied ${stats.copied} files; excluded ${stats.excluded.length}; skipped ${stats.skippedLinks.length} symlink(s).`
);

// Hard gate: the last point before `tauri build` globs this tree into an
// installer. Cheap, and it catches anything a future edit to the filter misses.
const leaked = findLeakedNames(resourcesDest);
if (leaked.length) {
  fs.rmSync(resourcesDest, { recursive: true, force: true });
  console.error("[build-tauri-frontend] FATAL: secret material reached the Tauri resource tree:");
  for (const f of leaked) console.error(`  ${f}`);
  console.error("Refusing to produce an installer. The resource tree has been removed.");
  process.exit(1);
}

console.log("[build-tauri-frontend] Done. Resource tree scanned; no secret material.");
