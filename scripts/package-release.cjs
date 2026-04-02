#!/usr/bin/env node
/**
 * Package .next/standalone for release: creates dist/zippymesh-router-<version>.zip
 * excluding .env. Run after npm run build. Prints next steps for gh release.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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

const zipName = `zippymesh-router-v${version}.zip`;
const zipPath = path.join(distDir, zipName);

if (fs.existsSync(zipPath)) {
  try { fs.rmSync(zipPath, { force: true }); } catch (_) {}
}

// Exclude .env from the archive: on Windows use a temp copy; on Unix use zip -x
const standaloneEnv = path.join(standaloneDir, ".env");
const hasEnv = fs.existsSync(standaloneEnv);

// Zip so contents are at archive root (user runs store-bootstrap.cjs once then node run.js)
if (process.platform === "win32") {
  // Compress directly; exclude .env and data (junction) to avoid EPERM and secrets
  const ps = `$standalone='${standaloneDir.replace(/'/g, "''")}'; $zipPath='${zipPath.replace(/'/g, "''")}'; $exclude=@('.env','data'); $items=Get-ChildItem -Path $standalone | Where-Object { $exclude -notcontains $_.Name }; Compress-Archive -Path $items.FullName -DestinationPath $zipPath -Force`;
  execSync(`powershell -NoProfile -Command ${JSON.stringify(ps)}`, { cwd: root, stdio: "inherit" });
} else {
  const exclude = hasEnv ? ' -x ".env"' : "";
  execSync(
    `zip -r "${zipPath}" . ${exclude}`.trim(),
    { cwd: standaloneDir, stdio: "inherit" }
  );
}

console.log(`\nCreated: ${zipPath}`);
console.log("\nNext steps (from zippymesh-dist or this repo):");
console.log(`  gh release create v${version} dist/${zipName} --notes "Release v${version}"`);
console.log("  Or create the release in GitHub UI and upload the zip.");
console.log("  Do not add .env to the release.");