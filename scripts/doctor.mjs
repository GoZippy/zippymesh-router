#!/usr/bin/env node
/**
 * scripts/doctor.mjs — `zmlr doctor`
 *
 * A dependency-free (Node >= 20 builtins only) preflight for a ZippyMesh /
 * ZMLR install. It answers "why doesn't this work" without starting the app:
 * environment, data directory, database, proxy trust, bind exposure, build
 * freshness, vault state and local provider reachability.
 *
 *   node scripts/doctor.mjs
 *   node scripts/doctor.mjs --json
 *   node scripts/doctor.mjs --url http://127.0.0.1:20128
 *   node scripts/doctor.mjs --data-dir /tmp/zmlr-scratch
 *
 * Exit code: 1 if any check FAILED, otherwise 0 (warnings do not fail).
 *
 * Read-only by design: the ONLY file it ever writes is a probe file inside a
 * data directory the operator named explicitly with --data-dir or DATA_DIR.
 * It never writes inside the real per-user store, and it never prints a secret
 * value, an API key, or a vault entry name. (One honest caveat: opening a
 * WAL-mode SQLite database read-only still makes SQLite map the shared-memory
 * index, so zippymesh.db-shm can get a new mtime. No data is modified.)
 *
 * All the logic lives in scripts/doctor/checks.mjs (pure, injectable) — this
 * file only builds the real context and renders the output.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { runAllChecks, exitCodeFor, resolveDataDir } from "./doctor/checks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const DEFAULT_URL = "http://127.0.0.1:20128";
const HTTP_TIMEOUT_MS = 3000;
const PROVIDER_TIMEOUT_MS = 3000;

const USAGE = `zmlr doctor — check a ZippyMesh install before you blame it

Usage:
  node scripts/doctor.mjs [options]

Options:
  --json                 Emit a machine-readable JSON array of check results
  --url <url>            Base URL of a running server (default ${DEFAULT_URL})
  --data-dir <path>      Override the data directory (also enables the write probe)
  -h, --help             Show this help

Exit code: 1 if any check FAILED, 0 otherwise (warnings do not fail).
`;

function parseArgs(argv) {
  const opts = { json: false, url: DEFAULT_URL, dataDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--url") opts.url = argv[++i] ?? DEFAULT_URL;
    else if (a.startsWith("--url=")) opts.url = a.slice("--url=".length);
    else if (a === "--data-dir") opts.dataDir = argv[++i] ?? null;
    else if (a.startsWith("--data-dir=")) opts.dataDir = a.slice("--data-dir=".length);
    else {
      process.stderr.write(`doctor: unknown argument "${a}"\n\n${USAGE}`);
      process.exit(2);
    }
  }
  return opts;
}

/** git HEAD commit time, or null when git is unavailable / this is not a repo. */
function gitHeadIso() {
  try {
    const r = spawnSync("git", ["log", "-1", "--format=%cI"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    if (r.status !== 0) return null;
    const out = (r.stdout || "").trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Open zippymesh.db READ-ONLY with better-sqlite3 if it is resolvable, and
 * pull only the facts the doctor reports. Never opens read-write, never
 * migrates, never reads an encrypted value.
 */
function readSqlite(file) {
  let Database;
  for (const from of [path.join(REPO_ROOT, "package.json"), path.join(process.cwd(), "package.json")]) {
    try {
      Database = createRequire(from)("better-sqlite3");
      break;
    } catch {
      /* try the next resolution root */
    }
  }
  if (!Database) return { available: false, error: "better-sqlite3 could not be resolved" };

  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const userVersion = db.pragma("user_version", { simple: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);

    let localNodes = [];
    if (tables.includes("provider_nodes")) {
      try {
        localNodes = db
          .prepare("SELECT name, baseUrl, apiType FROM provider_nodes WHERE type = 'local'")
          .all()
          .map((r) => ({ name: r.name, baseUrl: r.baseUrl, apiType: r.apiType }));
      } catch {
        localNodes = [];
      }
    }
    return { available: true, userVersion, tableCount: tables.length, tables, localNodes };
  } catch (e) {
    return { available: false, error: e.message };
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

function buildContext(opts) {
  const env = process.env;
  return {
    fs,
    env,
    cwd: process.cwd(),
    platform: process.platform,
    homedir: os.homedir(),
    nodeVersion: process.version,
    now: () => Date.now(),
    fetch: (...a) => fetch(...a),
    timeoutSignal: (ms) => AbortSignal.timeout(ms),
    httpTimeoutMs: HTTP_TIMEOUT_MS,
    providerTimeoutMs: PROVIDER_TIMEOUT_MS,
    gitHeadIso,
    readSqlite,
    url: opts.url,
    dataDir: resolveDataDir({ env, platform: process.platform, homedir: os.homedir(), override: opts.dataDir }),
  };
}

const SYMBOL = { ok: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP" };

function render(results) {
  const lines = [];
  lines.push("");
  lines.push("zmlr doctor");
  lines.push("===========");
  lines.push("");
  for (const r of results) {
    lines.push(`[${SYMBOL[r.status] ?? r.status}] ${r.title}`);
    for (const l of String(r.detail).split("\n")) lines.push(`       ${l}`);
    if (r.remedy && r.status !== "ok") lines.push(`       -> ${r.remedy}`);
    lines.push("");
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  lines.push(`${count("ok")} ok, ${count("warn")} warning(s), ${count("fail")} failure(s), ${count("skip")} skipped`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Close the keep-alive sockets that global fetch leaves behind.
 *
 * Without this, calling process.exit() on Windows/Node 24 while undici still
 * holds a pooled socket trips a libuv assertion
 * ("!(handle->flags & UV_HANDLE_CLOSING), src\\win\\async.c") and the process
 * aborts with 0xC0000409 instead of returning the doctor's exit code — which
 * would make the CI signal useless. Closing the dispatcher lets the event loop
 * drain on its own, so we can set process.exitCode and simply return.
 */
async function shutdownHttp() {
  try {
    const dispatcher = globalThis[Symbol.for("undici.globalDispatcher.1")];
    if (dispatcher && typeof dispatcher.close === "function") await dispatcher.close();
  } catch {
    /* nothing to close, or a Node build without the global dispatcher */
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const ctx = buildContext(opts);
  const results = await runAllChecks(ctx);

  if (opts.json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    process.stdout.write(render(results));
  }
  await shutdownHttp();
  return exitCodeFor(results);
}

main()
  .then((code) => {
    // Set the code and let the loop drain (see shutdownHttp) rather than
    // calling process.exit(), which can abort mid-teardown on Windows.
    process.exitCode = code;
  })
  .catch(async (err) => {
    process.stderr.write(`doctor: unexpected error: ${err?.stack || err}\n`);
    await shutdownHttp();
    process.exitCode = 2;
  });
