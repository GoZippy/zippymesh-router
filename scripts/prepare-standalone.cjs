#!/usr/bin/env node
/**
 * Prepare the standalone deployable in `.next/standalone`.
 *
 * Copies static + public + the launch scripts and docs a released zip needs,
 * and patches the Next.js-generated `server.js` entry point so the shipped
 * artifact actually behaves the way `docs/SETUP.md` and `.env.example` promise.
 *
 * Run after: npm run build:next
 * Then run (from inside the bundle): node server.js   (or ./start-stable.sh)
 *
 * Repairing an existing unpacked install without rebuilding:
 *   node scripts/prepare-standalone.cjs --patch-server <path-to-unpacked-dir>
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const distDir = process.env.ZIPPY_NEXT_DIST_DIR || '.next';
const standalone = path.join(root, distDir, 'standalone');
const staticDir = path.join(root, distDir, 'static');
const publicDir = path.join(root, 'public');
const standaloneNext = path.join(standalone, '.next');

/** Default HTTP port. Must match docs/SETUP.md and .env.example's ZIPPY_PORT. */
const DEFAULT_PORT = 20128;

/** Sentinel that makes patchStandaloneServerEntry idempotent. */
const PREAMBLE_MARKER = 'ZippyMesh standalone preamble';

// ---------------------------------------------------------------------------
// `--patch-server <dir>` escape hatch: re-apply the entry-point patch to an
// already-unpacked install. Placed before the main body so it does not require
// a build tree. `require()` from scripts/build.cjs never hits this branch.
// ---------------------------------------------------------------------------
if (process.argv[2] === '--patch-server') {
  const target = path.resolve(process.argv[3] || process.cwd());
  const ok = patchStandaloneServerEntry(target);
  writeLaunchScripts(target);
  process.exit(ok ? 0 : 1);
}

if (!fs.existsSync(standalone)) {
  console.error(`Missing ${distDir}/standalone — run npm run build:next first.`);
  process.exit(1);
}

if (fs.existsSync(staticDir)) {
  const dest = path.join(standaloneNext, 'static');
  fs.mkdirSync(standaloneNext, { recursive: true });
  copyRecursive(staticDir, dest);
  console.log(`Copied ${distDir}/static -> ${distDir}/standalone/.next/static`);
}

if (fs.existsSync(publicDir)) {
  const dest = path.join(standalone, 'public');
  copyRecursive(publicDir, dest);
  console.log(`Copied public -> ${distDir}/standalone/public`);
}

// Install and run guide + env template for prebuilt zip
const standaloneReadme = path.join(root, 'docs', 'STANDALONE_README.md');
const envExample = path.join(root, '.env.example');
if (fs.existsSync(standaloneReadme)) {
  fs.copyFileSync(standaloneReadme, path.join(standalone, 'README.md'));
  console.log(`Copied docs/STANDALONE_README.md -> ${distDir}/standalone/README.md`);
}
if (fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, path.join(standalone, '.env.example'));
  console.log(`Copied .env.example -> ${distDir}/standalone/.env.example`);
}

// Guardrail rules. `next build` bundles src/utils/guardrails.js but NOT the
// config/ directory it reads, so a shipped build resolved 0 rules and
// checkSafety() was silently inert (2026-08-30). The runtime now also looks in
// <cwd>/config (server.js chdir()s to the bundle root), so place it there.
const guardrailsConfig = path.join(root, 'config', 'guardrails.config.json');
if (fs.existsSync(guardrailsConfig)) {
  const destDir = path.join(standalone, 'config');
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(guardrailsConfig, path.join(destDir, 'guardrails.config.json'));
  console.log(`Copied config/guardrails.config.json -> ${distDir}/standalone/config/`);
} else {
  console.warn('[guardrails] config/guardrails.config.json not found — the bundle will ship with content rules DISABLED.');
}

// Bootstrap (no .env): run.js + bootstrapEnv.cjs + store-bootstrap.cjs
const bootstrapEnv = path.join(root, 'scripts', 'bootstrapEnv.cjs');
const runWithBootstrap = path.join(root, 'scripts', 'run-with-bootstrap.js');
const storeBootstrap = path.join(root, 'scripts', 'store-bootstrap.cjs');
if (fs.existsSync(bootstrapEnv)) {
  fs.copyFileSync(bootstrapEnv, path.join(standalone, 'bootstrapEnv.cjs'));
  console.log(`Copied scripts/bootstrapEnv.cjs -> standalone`);
}
if (fs.existsSync(runWithBootstrap)) {
  fs.copyFileSync(runWithBootstrap, path.join(standalone, 'run.js'));
  console.log(`Copied scripts/run-with-bootstrap.js -> standalone/run.js`);
}
if (fs.existsSync(storeBootstrap)) {
  fs.copyFileSync(storeBootstrap, path.join(standalone, 'store-bootstrap.cjs'));
  console.log(`Copied scripts/store-bootstrap.cjs -> standalone`);
}

// Make the shipped entry point honour .env, the documented port, and the
// documented loopback-first bind. See patchStandaloneServerEntry.
// This is a security control, not a nicety: an unpatched bundle listens on
// 0.0.0.0. Fail the build rather than ship one.
if (!patchStandaloneServerEntry(standalone)) {
  console.error(
    'FATAL: could not harden the standalone entry point. Refusing to produce a ' +
      'bundle that would listen on 0.0.0.0:3000. See patchStandaloneServerEntry ' +
      'in scripts/prepare-standalone.cjs.'
  );
  process.exit(1);
}

// The launch scripts docs/SETUP.md tells users to run, generated for the bundle.
writeLaunchScripts(standalone);

// Copy sidecar binary to standalone bin/ so zippy-node-manager can find it
copySidecarBinary();

// Optional data symlink (opt-in — see setupDataSymlink)
setupDataSymlink();

console.log('Standalone app ready. From inside the bundle:');
console.log('  With .env:    node server.js   (or ./start-stable.sh / start-stable.cmd)');
console.log('  Without .env: node store-bootstrap.cjs   then   node run.js');

// ---------------------------------------------------------------------------

/**
 * Patch the Next.js-generated standalone entry point.
 *
 * Next generates, verbatim:
 *     const currentPort = parseInt(process.env.PORT, 10) || 3000
 *     const hostname = process.env.HOSTNAME || '0.0.0.0'
 *
 * Both lines run before Next loads `.env`, and both defaults contradict this
 * product:
 *   - port 3000, while every doc, the Dockerfile and .env.example say 20128;
 *   - 0.0.0.0, i.e. reachable from every machine on the LAN, while
 *     src/lib/net/bindHost.js and .env.example both document loopback-only as
 *     the secure default. The repo-root server.js carries that hardening, but
 *     `next build` regenerates this file and the hardening never shipped.
 *
 * Rather than rewriting Next's generated lines (brittle across versions) we
 * PREPEND a preamble that loads `.env` and normalises PORT and HOSTNAME before
 * the generated code reads them. Real environment variables always win over
 * `.env`, matching dotenv/Next semantics.
 *
 * Idempotent: a bundle that already carries the preamble is left alone.
 *
 * @param {string} dir directory containing the generated server.js
 * @returns {boolean} true when the entry point is patched (or already was)
 */
function patchStandaloneServerEntry(dir) {
  const serverFile = path.join(dir, 'server.js');
  if (!fs.existsSync(serverFile)) {
    console.warn(`[entry] No server.js in ${dir} — skipping entry-point patch.`);
    return false;
  }
  const original = fs.readFileSync(serverFile, 'utf8');
  if (original.includes(PREAMBLE_MARKER)) {
    console.log('[entry] server.js already patched — unchanged.');
    return true;
  }

  // Insert after Next's own prologue (which defines `require` and `__dirname`)
  // and before the first line that reads process.env.PORT.
  const anchor = original.match(/^const currentPort\s*=.*$/m);
  if (!anchor) {
    console.warn(
      '[entry] Could not find the generated `const currentPort = ...` line in ' +
        'server.js. Next.js may have changed its standalone template. The bundle ' +
        'will keep Next\'s defaults (0.0.0.0:3000) — fix scripts/prepare-standalone.cjs.'
    );
    return false;
  }
  const at = anchor.index;
  const patched = original.slice(0, at) + buildPreamble() + original.slice(at);
  fs.writeFileSync(serverFile, patched, 'utf8');
  console.log(
    `[entry] Patched server.js: loads .env, port ${DEFAULT_PORT} by default, loopback-first bind.`
  );
  return true;
}

function buildPreamble() {
  return `
// ── ${PREAMBLE_MARKER} (injected by scripts/prepare-standalone.cjs) ──────────
// Next's generated entry reads process.env.PORT and process.env.HOSTNAME below,
// BEFORE Next loads .env, and defaults to 0.0.0.0:3000. Neither default matches
// this product, so we resolve both here first. Real environment variables win
// over .env. Keep the bind precedence in sync with src/lib/net/bindHost.js.
{
  const zfs = require('node:fs');
  // The generated entry chdir()s into this directory, so Next only ever loads
  // <bundle>/.env. ZIPPY_ENV_FILE lets a launcher outside the bundle (the
  // repo-root start-stable scripts) point at its own .env without copying
  // secrets into the build output.
  const envFile = process.env.ZIPPY_ENV_FILE || path.join(__dirname, '.env');
  if (zfs.existsSync(envFile)) {
    for (const rawLine of zfs.readFileSync(envFile, 'utf8').split(/\\r?\\n/)) {
      const line = rawLine.trim().replace(/^export\\s+/, '');
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue; // real environment wins
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }

  // Router API keys are HMAC'd with API_KEY_SECRET; .env.example ships the
  // line EMPTY, and without a persistent value every issued key dies on the
  // next restart. JWT_SECRET is harder still: src/middleware.js and the login
  // route THROW when it is unset, so a release zip unpacked without running
  // the interactive store-bootstrap.cjs answered 500 to every request.
  // bootstrapEnv.cjs (shipped next to this file) generates each one into
  // <data dir>/bootstrap.secret the first time and reuses it after; an
  // explicit value from .env or the environment always wins.
  try {
    const zBoot = path.join(__dirname, 'bootstrapEnv.cjs');
    if (zfs.existsSync(zBoot)) {
      const zBootMod = require(zBoot);
      zBootMod.ensureApiKeySecret();
      zBootMod.ensureJwtSecret();
    }
  } catch (e) {
    console.warn('[ZippyMesh] Could not provision bootstrap secrets: ' + (e && e.message));
  }

  // Port: PORT, then ZIPPY_PORT (what .env.example and the Dockerfile ship),
  // then the documented default.
  const zPort = parseInt(process.env.PORT || process.env.ZIPPY_PORT, 10);
  process.env.PORT = String(Number.isFinite(zPort) && zPort > 0 ? zPort : ${DEFAULT_PORT});

  // Bind host: ZIPPY_BIND_HOST > HOST > HOSTNAME > 127.0.0.1 (loopback default).
  const zPick = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  const zBind =
    zPick(process.env.ZIPPY_BIND_HOST) ||
    zPick(process.env.HOST) ||
    zPick(process.env.HOSTNAME) ||
    '127.0.0.1';
  process.env.HOSTNAME = zBind;
  const zBare = zBind.toLowerCase().replace(/^\\[/, '').replace(/\\]$/, '');
  if (!['127.0.0.1', '::1', 'localhost'].includes(zBare)) {
    console.warn(
      '[ZippyMesh] Binding to ' + zBind + ' — this node is reachable from other ' +
        'machines on the network. Make sure login is enabled (/setup) before ' +
        'leaving it running. Set ZIPPY_BIND_HOST=127.0.0.1 for loopback only.'
    );
  }
}
// ── end ${PREAMBLE_MARKER} ──────────────────────────────────────────────────

`;
}

/**
 * Write the launch scripts docs/SETUP.md step 3 tells users to run. These live
 * INSIDE the bundle and start `./server.js` from the bundle directory, which is
 * where a released zip puts it (the zip's root IS the standalone directory —
 * there is no `.next/standalone` inside a release).
 *
 * Loopback by default; pass `--lan` (or set ZIPPY_BIND_HOST=0.0.0.0) to expose
 * the node to the network.
 */
function writeLaunchScripts(dir) {
  const cmd = `@echo off
REM ZippyMesh LLM Router - start the standalone bundle (generated by
REM scripts/prepare-standalone.cjs). Loopback only unless you pass --lan.
setlocal
cd /d "%~dp0"

if not exist "server.js" (
  echo server.js not found. Run this from the unpacked release folder.
  exit /b 1
)

REM Do NOT default PORT / ZIPPY_BIND_HOST here: server.js resolves them from
REM the environment first, then .env, then falls back to 127.0.0.1:${DEFAULT_PORT}.
REM Setting them here would silently override the operator's .env.
if /i "%~1"=="--lan" (
  set ZIPPY_BIND_HOST=0.0.0.0
  echo LAN mode: this node will be reachable from other machines. Enable login at /setup first.
)

echo Starting ZippyMesh Router (default http://127.0.0.1:${DEFAULT_PORT}; .env can override PORT / ZIPPY_BIND_HOST)
node server.js
`;

  const sh = `#!/usr/bin/env bash
# ZippyMesh LLM Router - start the standalone bundle (generated by
# scripts/prepare-standalone.cjs). Loopback only unless you pass --lan.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f server.js ]; then
  echo "server.js not found. Run this from the unpacked release folder." >&2
  exit 1
fi

# Do NOT default PORT / ZIPPY_BIND_HOST here: server.js resolves them from the
# environment first, then .env, then falls back to 127.0.0.1:${DEFAULT_PORT}.
# Setting them here would silently override the operator's .env.
if [ "\${1:-}" = "--lan" ]; then
  export ZIPPY_BIND_HOST=0.0.0.0
  echo "LAN mode: this node will be reachable from other machines. Enable login at /setup first."
fi

echo "Starting ZippyMesh Router (default http://127.0.0.1:${DEFAULT_PORT}; .env can override PORT / ZIPPY_BIND_HOST)"
exec node server.js
`;

  fs.writeFileSync(path.join(dir, 'start-stable.cmd'), cmd, 'utf8');
  const shPath = path.join(dir, 'start-stable.sh');
  fs.writeFileSync(shPath, sh, 'utf8');
  try {
    fs.chmodSync(shPath, 0o755);
  } catch {
    // Windows filesystems ignore the mode; the zip loses it anyway and
    // docs/SETUP.md tells Linux/macOS users to chmod +x after unpacking.
  }
  console.log('Wrote start-stable.cmd + start-stable.sh into the bundle.');
}

function copySidecarBinary() {
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'zippy-mesh-sidecar.exe' : 'zippy-mesh-sidecar';
  const src = path.join(root, 'sidecar', 'target', 'release', binaryName);
  if (!fs.existsSync(src)) {
    console.warn(`[sidecar] Binary not found at ${src} — skipping copy. Run 'cargo build --release' in sidecar/ first.`);
    return;
  }
  const binDir = path.join(standalone, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const dest = path.join(binDir, binaryName);
  fs.copyFileSync(src, dest);
  if (process.platform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }
  console.log(`Copied sidecar binary -> ${distDir}/standalone/bin/${binaryName}`);
}

/**
 * OPT-IN: link `<bundle>/data` at the per-user data directory.
 *
 * This used to run unconditionally, and it was a hazard:
 *   - it silently bound a build artifact to the operator's live secret store
 *     (db.json holds the bcrypt password hash, vault entries, provider
 *     credentials and agent tokens);
 *   - `zip -r` follows symlinks unless given `--symlinks`, so the Linux/macOS
 *     release path in scripts/package-release.cjs would have packaged that
 *     entire store into a public release archive;
 *   - nothing in the app needs it. src/lib/localDb.js resolves the data
 *     directory itself (DATA_DIR, else the platform path); the link only ever
 *     mattered for the discouraged `DATA_DIR=./data` layout.
 *
 * Set ZIPPY_STANDALONE_DATA_LINK=1 if you deliberately want the old behaviour.
 */
function setupDataSymlink() {
  if (process.env.ZIPPY_STANDALONE_DATA_LINK !== '1') {
    console.log(
      '[data] Skipping the standalone data symlink (set ZIPPY_STANDALONE_DATA_LINK=1 to create it). ' +
        'The app resolves its data directory from DATA_DIR or the platform default.'
    );
    return;
  }

  const appName = process.env.ZIPPY_APP_NAME || 'zippy-mesh';
  const standaloneData = path.join(standalone, 'data');

  // Must match getUserDataDir() in src/lib/localDb.js — including macOS, which
  // uses ~/.zippy-mesh and NOT ~/Library/Application Support.
  let userDataDir;
  if (process.env.DATA_DIR) {
    userDataDir = path.resolve(process.env.DATA_DIR);
  } else if (process.platform === 'win32') {
    userDataDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
  } else {
    userDataDir = path.join(os.homedir(), `.${appName}`);
  }

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
    console.log(`Created user data directory: ${userDataDir}`);
  }

  try {
    const stat = fs.lstatSync(standaloneData);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(standaloneData);
      if (path.resolve(standalone, target) === userDataDir || target === userDataDir) {
        console.log(`Data symlink already correct: ${standaloneData} -> ${userDataDir}`);
        return;
      }
      fs.unlinkSync(standaloneData);
    } else if (stat.isDirectory()) {
      console.log('Migrating existing standalone data to user directory...');
      migrateData(standaloneData, userDataDir);
      fs.rmSync(standaloneData, { recursive: true, force: true });
    }
  } catch (e) {
    // Doesn't exist, which is fine
  }

  try {
    if (process.platform === 'win32') {
      // Use directory junction on Windows (no admin required)
      execSync(`mklink /J "${standaloneData}" "${userDataDir}"`, { stdio: 'ignore', shell: true });
    } else {
      fs.symlinkSync(userDataDir, standaloneData, 'dir');
    }
    console.log(`Created data symlink: ${standaloneData} -> ${userDataDir}`);
  } catch (e) {
    console.warn(`Warning: Could not create symlink (${e.message}). Data will be stored locally.`);
  }
}

function migrateData(src, dest) {
  if (!fs.existsSync(src)) return;

  for (const file of fs.readdirSync(src)) {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);

    // Only migrate if dest doesn't exist (don't overwrite user data)
    if (!fs.existsSync(destPath)) {
      if (fs.statSync(srcPath).isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
      console.log(`  Migrated: ${file}`);
    } else {
      console.log(`  Skipped (exists in user dir): ${file}`);
    }
  }
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) {
      copyRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
