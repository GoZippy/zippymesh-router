#!/usr/bin/env node
/**
 * Production build: Next.js standalone + prepare-standalone.
 * Equivalent to: npm run build:next && npm run prepare-standalone
 * Use: npm run build  OR  npm run build:standalone
 */
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");

function walkFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".") || entry.name === ".next") {
        continue;
      }
      out.push(...walkFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(fullPath);
  }
  return out;
}

function scanForSecrets() {
  const rootPatterns = [
    { name: "Hardcoded clientSecret value", regex: /\bclientSecret\s*:\s*["'`]([^"'`]+)["'`]/g },
    { name: "Hardcoded clientSecret assignment", regex: /\bclientSecret\s*=\s*["'`]([^"'`]+)["'`]/g },
    { name: "OpenAI key pattern", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
    { name: "Google API key pattern", regex: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
    { name: "GOCSPX-style secret", regex: /GOCSPX-[A-Za-z0-9_-]{8,}/g },
  ];
  const suspicious = [];
  const scanDirs = [path.join(root, "src"), path.join(root, "open-sse")];

  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = walkFiles(dir);
    for (const filePath of files) {
      const rel = path.relative(root, filePath);
      if (!/\.(js|mjs|ts|json|md|env)$/.test(filePath)) {
        continue;
      }
      const text = fs.readFileSync(filePath, "utf8");
      for (const pattern of rootPatterns) {
        const matches = [...text.matchAll(pattern.regex)];
        for (const match of matches) {
          const token = match[0];
          if (
            token === "REDACTED_IN_SOURCE" ||
            token === "REDACTED" ||
            token === "PLACEHOLDER" ||
            token.includes("your-")
          ) {
            continue;
          }
        if (token.startsWith("ZIPPY_M") || token.includes("PLACEHOLDER") || token.includes("REDACTED")) {
          continue;
        }
        if (token.includes("process.env") || token.includes("${")) {
          continue;
        }
          const line = text.substring(0, match.index).split(/\r?\n/).length;
          suspicious.push({ file: rel, line, token: token.slice(0, 20) + "..." });
        }
      }
    }
  }

  if (suspicious.length) {
    console.error("Blocked build: potential hardcoded secrets were detected.");
    for (const item of suspicious) {
      console.error(` - ${item.file}:${item.line}: ${item.token}`);
    }
    return false;
  }
  return true;
}

if (!scanForSecrets()) {
  process.exit(1);
}

function isWindowsBetterSqlite3UnlinkEperm(error) {
  if (process.platform !== "win32") return false;
  const errorText = `${error?.message || ""}\n${error?.stderr?.toString?.() || ""}\n${error?.stdout?.toString?.() || ""}`;
  return (
    errorText.includes("EPERM") &&
    errorText.includes("unlink") &&
    (errorText.includes("better_sqlite3") || errorText.includes("better-sqlite3"))
  );
}

function cleanupStaleStandaloneBetterSqlite3(distDir) {
  if (process.platform !== "win32") return;
  const nativeDir = path.join(
    root,
    distDir,
    "standalone",
    "node_modules",
    "better-sqlite3"
  );
  const nativeBinary = path.join(
    nativeDir,
    "build",
    "Release",
    "better_sqlite3.node"
  );
  try {
    relaxPermissionsRecursive(nativeDir);
    if (fs.existsSync(nativeBinary)) {
      fs.chmodSync(nativeBinary, 0o666);
      fs.rmSync(nativeBinary, { force: true });
    }
  } catch {
    // Best-effort cleanup only; build retry logic still handles transient locks.
  }
}

function relaxPermissionsRecursive(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) return;
  const stat = fs.lstatSync(targetPath);
  fs.chmodSync(targetPath, stat.isDirectory() ? 0o777 : 0o666);
  if (!stat.isDirectory()) return;
  for (const name of fs.readdirSync(targetPath)) {
    relaxPermissionsRecursive(path.join(targetPath, name));
  }
}

function runBuildNextWithWindowsRetry() {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const distDir = attempt === 1 ? ".next" : `.next-win-retry-${attempt}`;
    process.env.ZIPPY_NEXT_DIST_DIR = distDir;
    cleanupStaleStandaloneBetterSqlite3(distDir);
    try {
      if (attempt > 1) {
        console.warn(`[build] Retrying with isolated distDir: ${distDir}`);
      }
      const out = execSync("npm run build:next", {
        cwd: root,
        env: { ...process.env, ZIPPY_NEXT_DIST_DIR: distDir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (out && out.length) {
        process.stdout.write(out.toString());
      }
      return;
    } catch (e) {
      const stdoutText = e?.stdout?.toString?.() || "";
      const stderrText = e?.stderr?.toString?.() || "";
      if (stdoutText) process.stdout.write(stdoutText);
      if (stderrText) process.stderr.write(stderrText);
      const canRetry = isWindowsBetterSqlite3UnlinkEperm(e) && attempt < maxAttempts;
      if (!canRetry) {
        process.exit(e.status ?? 1);
      }
      const waitMs = attempt * 1500;
      console.warn(
        `[build] Transient Windows file lock detected (better_sqlite3 unlink EPERM). Retrying in ${waitMs}ms...`
      );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
}

try {
  runBuildNextWithWindowsRetry();
} catch (e) {
  process.exit(e.status ?? 1);
}

try {
  require("./prepare-standalone.cjs");
} catch (e) {
  console.error("prepare-standalone failed:", e.message);
  process.exit(1);
}
const finalDistDir = process.env.ZIPPY_NEXT_DIST_DIR || ".next";
console.log(`Build complete. Run: node ${finalDistDir}/standalone/server.js (PORT=20128)`);
