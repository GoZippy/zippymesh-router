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
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

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
console.log("[build-tauri-frontend] Copying .next/standalone → src-tauri/resources/standalone ...");
if (fs.existsSync(resourcesDest)) {
  fs.rmSync(resourcesDest, { recursive: true, force: true });
}
fs.cpSync(standaloneDir, resourcesDest, { recursive: true });
console.log("[build-tauri-frontend] Done.");
