#!/usr/bin/env node
/**
 * ZMLR end-to-end runner — production build, throwaway DATA_DIR.
 *
 * Starts `.next/standalone` exactly the way a release user does (`node run.js`,
 * which loads bootstrapEnv.cjs and then Next's generated server.js), waits for
 * GET /api/health, runs `node --test` over a set of .test.mjs files, then kills
 * the server and deletes the data directory.
 *
 * Dependency-free on purpose: node: builtins only, Node >= 20.
 *
 *   node scripts/e2e/run-standalone.mjs                 # all built-in suites
 *   node scripts/e2e/run-standalone.mjs --suite core    # one suite
 *   node scripts/e2e/run-standalone.mjs tests/e2e/foo   # ad-hoc files/dirs, one pass
 *
 * Flags
 *   --suite <name>     run only this built-in suite (repeatable)
 *   --port <n>         bind this port instead of scanning 20301..20310
 *   --keep             keep the DATA_DIR + server log and print their paths
 *   --filter <glob>    only run test files whose path matches (glob or substring)
 *   --env K=V          extra env for the SERVER process (repeatable)
 *   --list             print what would run, then exit
 *
 * Built-in suites (each gets its own server process and its own DATA_DIR, so a
 * suite can never poison another suite's in-memory rate-limit windows):
 *
 *   core      tests/e2e/vault-tokens/core       no extra env
 *   limits    tests/e2e/vault-tokens/limits     no extra env; fills one token's 60/min bucket
 *   authfail  tests/e2e/vault-tokens/authfail   no extra env; SPENDS the peer's 30/min
 *                                               auth-failure budget, which blocks every
 *                                               later vault-token call from that peer for
 *                                               the rest of the window — hence its own pass
 *   proxy     tests/e2e/vault-tokens/proxy      TRUST_PROXY=1
 *
 * Env handed to the test processes (the contract tests rely on):
 *   ZMLR_E2E_BASE_URL         http://127.0.0.1:<port>
 *   ZMLR_E2E_ADMIN_PASSWORD   dashboard password the suite sets up on first run
 *   ZMLR_E2E_VAULT_PASSWORD   vault master password the suite unlocks with
 *   ZMLR_E2E_SECRET_SEED      seed the fixtures derive entry values from
 *   ZMLR_E2E_SUITE            suite name
 *
 * Safety: the server is always given DATA_DIR under os.tmpdir() and a freshly
 * generated JWT_SECRET, and app-owned env vars inherited from the operator's
 * shell are stripped before spawn. After each pass the runner asserts the
 * throwaway DATA_DIR actually got the SQLite/lowdb files, which is the proof
 * that %APPDATA%\zippy-mesh was not the store in use.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PORT_RANGE = [20301, 20310];
const HEALTH_TIMEOUT_MS = 90_000;
const LOG_TAIL_LINES = 40;

const SUITES = [
  { name: "core", dir: "tests/e2e/vault-tokens/core", env: {} },
  { name: "limits", dir: "tests/e2e/vault-tokens/limits", env: {} },
  { name: "authfail", dir: "tests/e2e/vault-tokens/authfail", env: {} },
  { name: "proxy", dir: "tests/e2e/vault-tokens/proxy", env: { TRUST_PROXY: "1" } },
  // OpenAI-compatible surface against a real local Ollama (127.0.0.1:11434).
  // Slow (minutes) — see docs/_internal/E2E_ROUTING_2026-08-30.md.
  { name: "routing", dir: "tests/e2e/routing", env: {} },
];

// ── argv ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { suites: [], targets: [], port: null, keep: false, filter: null, env: {}, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keep") opts.keep = true;
    else if (a === "--list") opts.list = true;
    else if (a === "--port") opts.port = Number(argv[++i]);
    else if (a === "--filter") opts.filter = argv[++i];
    else if (a === "--suite") opts.suites.push(argv[++i]);
    else if (a === "--env") {
      const kv = argv[++i] ?? "";
      const eq = kv.indexOf("=");
      if (eq < 1) die(`--env expects K=V, got ${JSON.stringify(kv)}`);
      opts.env[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a.startsWith("--")) die(`unknown flag ${a}`);
    else opts.targets.push(a);
  }
  return opts;
}

function die(msg) {
  console.error(`[e2e] ${msg}`);
  process.exit(2);
}

// ── file discovery ───────────────────────────────────────────────────────────

function collectTestFiles(target) {
  const abs = path.isAbsolute(target) ? target : path.join(REPO_ROOT, target);
  if (!fs.existsSync(abs)) die(`no such test path: ${abs}`);
  if (fs.statSync(abs).isFile()) return [abs];
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".test.mjs")) out.push(full);
    }
  })(abs);
  return out;
}

function matchesFilter(file, filter) {
  if (!filter) return true;
  const posix = file.split(path.sep).join("/");
  if (!/[*?]/.test(filter)) return posix.includes(filter);
  const rx = new RegExp(filter.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."));
  return rx.test(posix);
}

// ── standalone build discovery ───────────────────────────────────────────────

/**
 * The dist dir the build actually produced (scripts/build.cjs may fall back to
 * .next-win-retry-N). `ZMLR_E2E_DIST_DIR=.next-foo` pins an isolated build
 * made with `ZIPPY_NEXT_DIST_DIR=.next-foo npm run build:next` so several
 * verification builds can coexist without touching the shared `.next`.
 */
function findStandaloneDir() {
  const pinned = process.env.ZMLR_E2E_DIST_DIR;
  if (pinned) {
    const dir = path.join(path.isAbsolute(pinned) ? pinned : path.join(REPO_ROOT, pinned), "standalone");
    if (!fs.existsSync(path.join(dir, "server.js"))) {
      die(`ZMLR_E2E_DIST_DIR=${pinned} has no standalone/server.js — build it with ZIPPY_NEXT_DIST_DIR=${pinned} npm run build:next && ZIPPY_NEXT_DIST_DIR=${pinned} node scripts/prepare-standalone.cjs`);
    }
    return dir;
  }
  const candidates = fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && (e.name === ".next" || e.name.startsWith(".next-win-retry-")))
    .map((e) => path.join(REPO_ROOT, e.name, "standalone"))
    .filter((d) => fs.existsSync(path.join(d, "server.js")));
  if (candidates.length === 0) {
    die("no production build found — expected <distDir>/standalone/server.js. Run `npm run build` first.");
  }
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

/**
 * The entry a release user runs. prepare-standalone.cjs ships run.js
 * (scripts/run-with-bootstrap.js) next to Next's generated server.js and its
 * README tells the user `node run.js`; run.js only injects bootstrap secrets
 * from DATA_DIR when a bootstrap.secret exists, so a throwaway DATA_DIR leaves
 * our PORT/JWT_SECRET intact. Fall back to server.js if run.js is absent.
 */
function resolveEntry(standaloneDir) {
  const runJs = path.join(standaloneDir, "run.js");
  return fs.existsSync(runJs) ? "run.js" : "server.js";
}

// ── ports ────────────────────────────────────────────────────────────────────

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

async function pickPort(requested) {
  if (requested) {
    if (!(await isPortFree(requested))) die(`port ${requested} is busy`);
    return requested;
  }
  for (let p = PORT_RANGE[0]; p <= PORT_RANGE[1]; p++) {
    if (await isPortFree(p)) return p;
  }
  die(`no free port in ${PORT_RANGE[0]}-${PORT_RANGE[1]}`);
}

// ── server lifecycle ─────────────────────────────────────────────────────────

/** Strip app-owned vars inherited from the operator's shell so a pass is reproducible. */
function baseEnv() {
  const env = { ...process.env };
  const drop = [
    "DATA_DIR", "JWT_SECRET", "PORT", "HOST", "HOSTNAME", "ZIPPY_BIND_HOST",
    "TRUST_PROXY", "INITIAL_PASSWORD", "ADMIN_USERNAME", "ADMIN_PASSWORD",
    "SUPERADMIN_PASSWORD", "ZIPPYVAULT_TOKEN", "ACTIVATION_API_URL",
    "ACTIVATION_API_KEY", "ZIPPY_APP_NAME", "ZIPPY_NEXT_DIST_DIR",
    "ENABLE_REQUEST_LOGS", "ZMLR_MCP_DEBUG",
  ];
  for (const k of drop) delete env[k];
  return env;
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed === true) {
    // still try taskkill: exitCode stays null until the exit event lands
  }
  if (!child || child.pid == null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
}

async function waitForHealth(baseUrl, child, log) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastErr = "no attempt made";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`server exited early (code=${child.exitCode} signal=${child.signalCode})`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (res.status === 200) {
        await res.arrayBuffer();
        return Date.now();
      }
      lastErr = `GET /api/health -> ${res.status}`;
    } catch (err) {
      lastErr = err?.message ?? String(err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out after ${HEALTH_TIMEOUT_MS}ms waiting for /api/health (last: ${lastErr})`);
}

function tail(text, lines) {
  const all = text.split(/\r?\n/);
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

// ── one pass ─────────────────────────────────────────────────────────────────

async function runPass({ name, files, extraEnv, opts, standaloneDir, entry }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `zmlr-e2e-${name}-`));
  const port = await pickPort(opts.port);
  const baseUrl = `http://127.0.0.1:${port}`;
  const jwtSecret = randomBytes(32).toString("hex");
  const adminPassword = `e2e-admin-${randomBytes(9).toString("hex")}`;
  const vaultPassword = `e2e-vault-${randomBytes(9).toString("hex")}`;
  const secretSeed = randomBytes(24).toString("hex");

  const serverEnv = {
    ...baseEnv(),
    ...extraEnv,
    ...opts.env,
    NODE_ENV: "production",
    PORT: String(port),
    // Next's generated standalone server.js binds `process.env.HOSTNAME || '0.0.0.0'`.
    // HOST / ZIPPY_BIND_HOST are set too for the repo-root server.js variant.
    HOSTNAME: "127.0.0.1",
    HOST: "127.0.0.1",
    ZIPPY_BIND_HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    JWT_SECRET: jwtSecret,
  };

  console.log(`\n[e2e] ── pass "${name}" ──`);
  console.log(`[e2e] standalone : ${path.relative(REPO_ROOT, standaloneDir)}/${entry}`);
  console.log(`[e2e] port       : ${port}`);
  console.log(`[e2e] DATA_DIR   : ${dataDir}`);
  const extra = { ...extraEnv, ...opts.env };
  console.log(`[e2e] extra env  : ${Object.keys(extra).length ? Object.keys(extra).map((k) => `${k}=${extra[k]}`).join(" ") : "(none)"}`);
  console.log(`[e2e] test files : ${files.length}`);

  const child = spawn(process.execPath, [entry], {
    cwd: standaloneDir,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  let serverLog = "";
  const capture = (chunk) => {
    serverLog += chunk.toString();
    if (serverLog.length > 512_000) serverLog = serverLog.slice(-256_000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  let exitCode = 1;
  try {
    const t0 = Date.now();
    await waitForHealth(baseUrl, child, serverLog);
    console.log(`[e2e] health ok in ${Date.now() - t0}ms`);

    const testEnv = {
      ...process.env,
      ZMLR_E2E_BASE_URL: baseUrl,
      ZMLR_E2E_ADMIN_PASSWORD: adminPassword,
      ZMLR_E2E_VAULT_PASSWORD: vaultPassword,
      ZMLR_E2E_SECRET_SEED: secretSeed,
      ZMLR_E2E_SUITE: name,
    };

    exitCode = await new Promise((resolve) => {
      const t = spawn(
        process.execPath,
        ["--test", "--test-concurrency=1", "--test-reporter=spec", ...files],
        { cwd: REPO_ROOT, env: testEnv, stdio: "inherit" },
      );
      t.on("exit", (code, signal) => resolve(signal ? 1 : code ?? 1));
    });
  } catch (err) {
    console.error(`[e2e] pass "${name}" failed to start: ${err.message}`);
    console.error(`[e2e] --- server output (last ${LOG_TAIL_LINES} lines) ---`);
    console.error(tail(serverLog, LOG_TAIL_LINES));
    console.error("[e2e] --- end server output ---");
    exitCode = 1;
  } finally {
    killTree(child);
    await new Promise((r) => setTimeout(r, 400));

    // Proof the throwaway store was the one in use.
    const stored = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];
    const usedStore = stored.includes("db.json") || stored.includes("zippymesh.db");
    if (!usedStore) {
      console.error(`[e2e] FAIL: ${dataDir} has no db.json/zippymesh.db — the server may have used another store.`);
      exitCode = exitCode || 1;
      if (exitCode === 0) exitCode = 1;
    }

    if (opts.keep) {
      const logFile = path.join(dataDir, "server.log");
      try { fs.writeFileSync(logFile, serverLog); } catch { /* best effort */ }
      console.log(`[e2e] --keep: DATA_DIR ${dataDir}`);
      console.log(`[e2e] --keep: server log ${logFile}`);
    } else {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
      } catch (err) {
        console.warn(`[e2e] could not remove ${dataDir}: ${err.message}`);
      }
    }
  }

  console.log(`[e2e] pass "${name}" exit=${exitCode}`);
  return exitCode;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let passes;
  if (opts.targets.length > 0) {
    const files = opts.targets.flatMap(collectTestFiles).filter((f) => matchesFilter(f, opts.filter));
    passes = [{ name: "adhoc", files, extraEnv: {} }];
  } else {
    const wanted = opts.suites.length ? opts.suites : SUITES.map((s) => s.name);
    for (const w of wanted) if (!SUITES.some((s) => s.name === w)) die(`unknown suite "${w}"`);
    passes = SUITES.filter((s) => wanted.includes(s.name)).map((s) => ({
      name: s.name,
      files: collectTestFiles(s.dir).filter((f) => matchesFilter(f, opts.filter)),
      extraEnv: s.env,
    }));
  }

  passes = passes.filter((p) => p.files.length > 0);
  if (passes.length === 0) die("no test files matched");

  if (opts.list) {
    for (const p of passes) {
      console.log(`${p.name} (${JSON.stringify(p.extraEnv)}):`);
      for (const f of p.files) console.log(`  ${path.relative(REPO_ROOT, f)}`);
    }
    return 0;
  }

  const standaloneDir = findStandaloneDir();
  const entry = resolveEntry(standaloneDir);

  let worst = 0;
  const summary = [];
  for (const p of passes) {
    const code = await runPass({ ...p, opts, standaloneDir, entry });
    summary.push([p.name, code]);
    if (code !== 0) worst = code;
  }

  console.log("\n[e2e] ── summary ──");
  for (const [name, code] of summary) console.log(`[e2e] ${code === 0 ? "PASS" : "FAIL"}  ${name} (exit ${code})`);
  return worst;
}

main().then(
  (code) => process.exit(code),
  (err) => { console.error(err); process.exit(1); },
);
