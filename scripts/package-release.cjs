#!/usr/bin/env node
/**
 * Package .next/standalone for release: creates
 * dist/zippymesh-router-v<version>-<platform>-<arch>.zip, excluding .env.
 * Run after npm run build. Prints next steps for gh release.
 *
 * The filename carries the platform because the archive IS platform-specific:
 * it contains a compiled better-sqlite3 (`.node`) for the machine that built
 * it. Three release legs used to emit the same filename, so the second upload
 * either failed or silently replaced a Windows build with a Linux one
 * (adversarial review 2026-08-30, item 6a).
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { LEAK_PATTERN, scanZipForLeaks } = require("./lib/zipScan.cjs");

const root = path.resolve(__dirname, "..");
const pkgPath = path.join(root, "package.json");
const standaloneDir = path.join(root, ".next", "standalone");
const distDir = path.join(root, "dist");

if (!fs.existsSync(pkgPath)) {
  console.error("package.json not found");
  process.exit(1);
}
const version = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
if (!version) {
  console.error("No version in package.json");
  process.exit(1);
}

if (!fs.existsSync(standaloneDir)) {
  console.error(".next/standalone not found. Run: npm run build");
  process.exit(1);
}

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Platform tag: `win32-x64`, `linux-x64`, `darwin-arm64`, … Same vocabulary as
// process.platform/process.arch so a CI matrix leg can predict its own filename.
const platformTag = `${process.platform}-${process.arch}`;
const zipName = `zippymesh-router-v${version}-${platformTag}.zip`;
const zipPath = path.join(distDir, zipName);

if (fs.existsSync(zipPath)) {
  try { fs.rmSync(zipPath, { force: true }); } catch (_) {}
}

// NEVER ship these. `data` is (optionally) a symlink/junction at the operator's
// real store — db.json holds the bcrypt password hash, vault entries, provider
// credentials and agent tokens — and `.env` / `bootstrap.secret` hold secrets.
const EXCLUDE_NAMES = [".env", "data", "bootstrap.secret"];

// Zip so contents are at archive root (user runs store-bootstrap.cjs once then node run.js)
if (process.platform === "win32") {
  // Compress directly; exclude the names above to avoid EPERM and secrets
  const excludeList = EXCLUDE_NAMES.map((n) => `'${n}'`).join(",");
  const ps = `$standalone='${standaloneDir.replace(/'/g, "''")}'; $zipPath='${zipPath.replace(/'/g, "''")}'; $exclude=@(${excludeList}); $items=Get-ChildItem -Force -Path $standalone | Where-Object { $exclude -notcontains $_.Name }; Compress-Archive -Path $items.FullName -DestinationPath $zipPath -Force`;
  execSync(`powershell -NoProfile -Command ${JSON.stringify(ps)}`, { cwd: root, stdio: "inherit" });
} else {
  // `--symlinks` is REQUIRED: without it `zip` FOLLOWS symlinks and stores the
  // contents they point at, which would package the operator's entire data
  // directory into a public release if the `data` link is present.
  const exclude = EXCLUDE_NAMES.flatMap((n) => ["-x", `"${n}"`, "-x", `"${n}/*"`]).join(" ");
  try {
    execSync(`zip -r --symlinks "${zipPath}" . ${exclude}`, {
      cwd: standaloneDir,
      stdio: "inherit",
    });
  } catch (e) {
    console.error(
      "zip failed. Install it (Debian/Ubuntu: sudo apt install zip; macOS ships it) and retry."
    );
    process.exit(e.status ?? 1);
  }
}

// ── the leak gate ────────────────────────────────────────────────────────────
//
// Fail loudly rather than publish a leaky archive. The scan lives in
// scripts/lib/zipScan.cjs and runs entirely in Node: it used to shell out, and
// on Windows five of its six guards could never match (adversarial review
// 2026-08-30 — security/install slice, C-2). See that file for the mechanism.
let entries;
let leaked;
try {
  ({ entries, leaked } = scanZipForLeaks(zipPath));
} catch (e) {
  fs.rmSync(zipPath, { force: true });
  console.error(`Refusing to publish: could not verify the archive (${e.message}).`);
  process.exit(1);
}

if (leaked.length) {
  fs.rmSync(zipPath, { force: true });
  console.error("Refusing to publish: the archive contained secret material:");
  for (const n of leaked) console.error(`  ${n}`);
  process.exit(1);
}
console.log(`Leak scan: ${entries.length} entries checked, none matched ${LEAK_PATTERN}.`);

console.log(`\nCreated: ${zipPath}`);
console.log("\nNext steps (from zippymesh-dist or this repo):");
console.log(`  gh release create v${version} dist/${zipName} --notes "Release v${version}"`);
console.log("  Or create the release in GitHub UI and upload the zip.");
console.log("  Do not add .env to the release.");
console.log(
  `  This archive is ${platformTag}-only (better-sqlite3 is compiled). Build the other platforms on their own machines.`
);