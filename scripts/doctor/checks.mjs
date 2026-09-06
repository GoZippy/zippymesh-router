/**
 * scripts/doctor/checks.mjs
 *
 * The check functions behind `zmlr doctor` (scripts/doctor.mjs).
 *
 * Every function here is PURE with respect to the process: it touches nothing
 * except the `ctx` object handed to it. fs, env, fetch, the clock, git and the
 * SQLite reader are all injected, so the unit tests exercise every ok / warn /
 * fail branch without a filesystem, a network or a database.
 *
 * A check returns:
 *   { id, title, status: "ok"|"warn"|"fail"|"skip", detail, remedy }
 *
 *   ok    — nothing to do
 *   warn  — works, but an operator should know (exit code stays 0)
 *   fail  — the node will not work correctly (exit code 1)
 *   skip  — could not be determined (missing optional dependency); exit 0
 *
 * `remedy` is a single line: what to type or change. Never a secret value.
 *
 * Node builtins only — no npm dependency. The bind-host and data-dir rules are
 * MIRRORED from src/lib/net/bindHost.js and src/lib/localDb.js so this script
 * also runs inside a standalone build where src/ does not exist. If either of
 * those files changes, change the mirror below (tests/unit/doctorChecks.test.js
 * pins the current behaviour).
 */

import path from "node:path";

// ── result helpers ────────────────────────────────────────────────────────────

export function mk(id, title, status, detail, remedy = null) {
  return { id, title, status, detail, remedy };
}

/** Worst status wins: fail > warn > skip > ok. */
export function worstStatus(results) {
  if (results.some((r) => r.status === "fail")) return "fail";
  if (results.some((r) => r.status === "warn")) return "warn";
  if (results.some((r) => r.status === "skip")) return "skip";
  return "ok";
}

// ── pure resolution helpers (also used by the tests) ──────────────────────────

/** Mirror of src/lib/net/bindHost.js resolveBindHost(). */
export function resolveBindHostLike(env = {}) {
  const pick = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  // server.js passes HOST ?? HOSTNAME as `HOST`, so fold HOSTNAME in last.
  return pick(env.ZIPPY_BIND_HOST) ?? pick(env.HOST) ?? pick(env.HOSTNAME) ?? "127.0.0.1";
}

/** Mirror of src/lib/net/bindHost.js isLoopbackHost(). */
export function isLoopbackHostLike(host) {
  if (typeof host !== "string") return false;
  const h = host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

/**
 * Mirror of src/lib/localDb.js getUserDataDir(), plus an explicit override.
 * @returns {{ dir: string, source: "flag"|"env"|"default" }}
 */
export function resolveDataDir({ env = {}, platform = process.platform, homedir = "", override = null } = {}) {
  if (override) return { dir: override, source: "flag" };
  if (env.DATA_DIR) return { dir: env.DATA_DIR, source: "env" };
  const appName = env.ZIPPY_APP_NAME || "zippy-mesh";
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(homedir, "AppData", "Roaming");
    return { dir: path.join(appData, appName), source: "default" };
  }
  return { dir: path.join(homedir, `.${appName}`), source: "default" };
}

/**
 * The OS-conventional per-user directory, ignoring DATA_DIR. scripts/setup-env.mjs
 * writes router-config.json here unconditionally, so the doctor has to look here
 * even when DATA_DIR points somewhere else.
 */
export function resolveUserConfigDir({ env = {}, platform = process.platform, homedir = "" } = {}) {
  const appName = env.ZIPPY_APP_NAME || "zippy-mesh";
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(homedir, "AppData", "Roaming");
    return path.join(appData, appName);
  }
  return path.join(homedir, `.${appName}`);
}

/**
 * Port resolution as the code actually behaves today:
 *   - the standalone server.js binds `PORT` and falls back to 3000
 *   - the npm `dev` / `start` scripts hardcode -p 20128
 *   - ZIPPY_PORT is what .env.example documents, and what
 *     src/lib/discovery/localDiscovery.js + /api/mesh/peers/filtered advertise
 * They can disagree; the check below says so.
 */
export function resolvePorts(env = {}) {
  const num = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const port = num(env.PORT);
  const zippyPort = num(env.ZIPPY_PORT);
  return {
    port,
    zippyPort,
    serverPort: port ?? 3000, // what `node server.js` will bind
    advertisedPort: zippyPort ?? 20128, // what discovery/mesh advertise
    mismatch: (port ?? 3000) !== (zippyPort ?? 20128),
  };
}

/** Very small .env parser: KEY=VALUE lines, `#` comments, optional quotes. */
export function parseEnvFile(text) {
  const out = {};
  if (typeof text !== "string") return out;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Does this look like a placeholder rather than a real secret?
 * Never returns or logs the value itself.
 */
export function looksPlaceholderSecret(value) {
  if (typeof value !== "string") return true;
  const v = value.trim();
  if (v === "") return true;
  const lowered = v.toLowerCase();
  const markers = [
    "replace",
    "changeme",
    "change_me",
    "change-me",
    "your-",
    "your_",
    "xxx",
    "placeholder",
    "todo",
    "secret",
    "example",
    "test",
  ];
  return markers.some((m) => lowered.includes(m));
}

const PRIVATE_HOST_RE =
  /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})$/;

/** True for a base URL that points at this machine or a private/LAN address. */
export function isLocalOrLanUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local") || host.endsWith(".localhost")) return true;
  return PRIVATE_HOST_RE.test(host);
}

/**
 * A short, printable reason for a failed fetch.
 * `AbortSignal.timeout()` rejects with a DOMException named "TimeoutError"
 * whose legacy numeric `.code` is 23 — printing that number helps nobody.
 */
export function describeFetchError(e) {
  if (!e) return "unknown error";
  if (e.name === "TimeoutError" || e.name === "AbortError") return "timeout";
  const causeCode = e.cause?.code;
  if (typeof causeCode === "string") return causeCode;
  if (typeof e.code === "string") return e.code;
  return e.message || e.name || "unknown error";
}

/** Strip credentials from a URL before it is printed. */
export function safeUrl(raw) {
  try {
    const u = new URL(raw);
    u.username = "";
    u.password = "";
    u.search = "";
    return u.toString();
  } catch {
    return "<unparseable url>";
  }
}

// ── individual checks ─────────────────────────────────────────────────────────

export const MIN_NODE_MAJOR = 20;

export function checkNodeVersion(ctx) {
  const id = "node-version";
  const title = "Node.js version";
  const raw = String(ctx.nodeVersion || "");
  const major = parseInt(raw.replace(/^v/, "").split(".")[0], 10);
  const pkg = readJsonSafe(ctx, path.join(ctx.cwd, "package.json"));
  const declared = pkg?.value?.engines?.node ?? null;

  if (!Number.isFinite(major)) {
    return mk(id, title, "warn", `Could not parse Node version from "${raw}".`, `Run \`node --version\` and confirm it is >= ${MIN_NODE_MAJOR}.`);
  }
  if (major < MIN_NODE_MAJOR) {
    return mk(
      id,
      title,
      "fail",
      `Node ${raw} — ZippyMesh needs >= ${MIN_NODE_MAJOR}.`,
      `Install Node ${MIN_NODE_MAJOR} LTS or newer (nvm: \`nvm install ${MIN_NODE_MAJOR}\`), then re-run.`
    );
  }
  const engines = declared ? ` (package.json engines.node: ${declared})` : " (package.json declares no engines.node)";
  const status = declared ? "ok" : "warn";
  return mk(
    id,
    title,
    status,
    `Node ${raw}${engines}`,
    declared ? null : `Add \`"engines": { "node": ">=${MIN_NODE_MAJOR}" }\` to package.json so npm refuses an unsupported runtime.`
  );
}

export function checkContext(ctx) {
  const id = "context";
  const title = "Install context";
  const has = (p) => ctx.fs.existsSync(path.join(ctx.cwd, p));
  const isRepo = has("package.json") && has("src") && (has("next.config.mjs") || has("next.config.js"));
  const isStandalone = has("server.js") && has(".next") && !has("src");

  if (isRepo) return mk(id, title, "ok", "Source repository (src/ + next config present).");
  if (isStandalone) return mk(id, title, "ok", "Standalone build (server.js + .next, no src/).");
  return mk(
    id,
    title,
    "warn",
    "Neither a source repo nor a standalone build was recognised in the working directory.",
    "Run the doctor from the ZippyMesh repo root, or from the unpacked standalone directory."
  );
}

export function checkEnvFile(ctx) {
  const id = "env-file";
  const title = ".env and JWT_SECRET";
  const envPath = path.join(ctx.cwd, ".env");
  const filePresent = ctx.fs.existsSync(envPath);

  let fileVars = {};
  if (filePresent) {
    try {
      fileVars = parseEnvFile(ctx.fs.readFileSync(envPath, "utf8"));
    } catch (e) {
      return mk(id, title, "fail", `.env exists but could not be read: ${e.code || e.message}`, "Fix the file permissions on .env, or delete it and run `npm run setup`.");
    }
  }

  // A value in the process environment wins over the file (that is how node reads it).
  const fromProcess = ctx.env.JWT_SECRET;
  const fromFile = fileVars.JWT_SECRET;
  const effective = fromProcess ?? fromFile;
  const source = fromProcess ? "process environment" : fromFile ? ".env" : null;

  if (!effective) {
    return mk(
      id,
      title,
      "fail",
      filePresent ? ".env is present but sets no JWT_SECRET." : "No .env file and no JWT_SECRET in the environment.",
      "Run `npm run setup` (writes .env from the persisted router-config.json), or export JWT_SECRET yourself."
    );
  }
  if (looksPlaceholderSecret(effective)) {
    return mk(
      id,
      title,
      "fail",
      `JWT_SECRET (from ${source}) still looks like a placeholder.`,
      'Generate one: `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"` and set JWT_SECRET.'
    );
  }
  if (effective.length < 32) {
    return mk(id, title, "warn", `JWT_SECRET (from ${source}) is only ${effective.length} characters.`, "Use at least 32 characters (64 hex chars is the convention here).");
  }
  const note = filePresent ? "" : " (.env not present — value came from the environment)";
  return mk(id, title, "ok", `JWT_SECRET set from ${source}, ${effective.length} characters${note}.`);
}

/**
 * Bind host + port resolution. `requireLogin` is read from db.json by the
 * caller (checkDataStores does that read) and passed in, exactly the way
 * server.js does its best-effort read.
 */
export function checkBind(ctx, { requireLogin } = {}) {
  const id = "bind-host";
  const title = "Bind host";
  const host = resolveBindHostLike(ctx.env);
  const loopback = isLoopbackHostLike(host);

  if (!loopback && requireLogin === false) {
    return mk(
      id,
      title,
      "fail",
      `Bound to ${host} (reachable from the LAN) while settings.requireLogin is false — any host that can reach it is treated as superadmin.`,
      "Set requireLogin=true via /setup, or unset ZIPPY_BIND_HOST/HOST to return to the 127.0.0.1 default."
    );
  }
  if (!loopback) {
    const why = requireLogin === true ? "login is enabled" : "requireLogin could not be read";
    return mk(id, title, "warn", `Bound to ${host} — reachable from other machines (${why}).`, "Only expose to the LAN deliberately, and confirm requireLogin=true before you do.");
  }
  return mk(id, title, "ok", `Bound to ${host} (loopback only — nothing on the LAN can reach this node).`);
}

export function checkPorts(ctx) {
  const id = "ports";
  const title = "Port resolution";
  const p = resolvePorts(ctx.env);
  const parts = [
    `PORT=${p.port ?? "(unset)"} -> server.js binds ${p.serverPort}`,
    `ZIPPY_PORT=${p.zippyPort ?? "(unset)"} -> discovery/mesh advertise ${p.advertisedPort}`,
  ];
  if (p.mismatch) {
    return mk(
      id,
      title,
      "warn",
      `${parts.join("; ")} — these disagree.`,
      "Set PORT and ZIPPY_PORT to the same value (the npm dev/start scripts hardcode 20128, so `PORT=20128`)."
    );
  }
  return mk(id, title, "ok", parts.join("; ") + ".");
}

export function checkDataDir(ctx) {
  const id = "data-dir";
  const title = "Data directory";
  const { dir, source } = ctx.dataDir;
  const label = { flag: "--data-dir", env: "DATA_DIR", default: "OS default" }[source];

  if (!ctx.fs.existsSync(dir)) {
    return mk(
      id,
      title,
      "warn",
      `${dir} (${label}) does not exist yet.`,
      "It is created on first run; start the server once, or `mkdir` it if you are pre-seeding a deployment."
    );
  }

  // Only ever write inside a directory the operator explicitly pointed us at.
  const mayWrite = source === "flag" || source === "env";
  if (mayWrite) {
    const probe = path.join(dir, `.zmlr-doctor-write-probe-${ctx.now()}`);
    try {
      ctx.fs.writeFileSync(probe, "zmlr-doctor");
      ctx.fs.unlinkSync(probe);
      return mk(id, title, "ok", `${dir} (${label}) exists and is writable (verified by writing a probe file).`);
    } catch (e) {
      return mk(id, title, "fail", `${dir} (${label}) exists but is not writable: ${e.code || e.message}`, "Grant the account running ZippyMesh write access to that directory, or point DATA_DIR somewhere it has it.");
    }
  }

  // The real per-user store: probe permissions only, never write.
  try {
    ctx.fs.accessSync(dir, ctx.fs.constants.W_OK);
    return mk(id, title, "ok", `${dir} (${label}) exists and is writable (permission check only — no file was written).`);
  } catch (e) {
    return mk(id, title, "fail", `${dir} (${label}) is not writable: ${e.code || e.message}`, "Grant the account running ZippyMesh write access to that directory.");
  }
}

function readJsonSafe(ctx, file) {
  if (!ctx.fs.existsSync(file)) return { present: false, value: null, error: null };
  try {
    return { present: true, value: JSON.parse(ctx.fs.readFileSync(file, "utf8")), error: null };
  } catch (e) {
    return { present: true, value: null, error: e.message };
  }
}

/**
 * db.json: present, parseable, and what requireLogin says. Returns the check
 * plus the parsed settings so the bind check can use them.
 */
export function checkDbJson(ctx) {
  const id = "db-json";
  const title = "db.json";
  const file = path.join(ctx.dataDir.dir, "db.json");
  const r = readJsonSafe(ctx, file);

  if (!r.present) {
    return {
      result: mk(id, title, "warn", `${file} not found — this looks like a first run.`, "Start the server once (or run the /setup wizard); db.json is created automatically."),
      requireLogin: undefined,
    };
  }
  if (r.error) {
    return {
      result: mk(id, title, "fail", `${file} is present but is not valid JSON: ${r.error}`, "Restore db.json from a backup, or move it aside so a fresh one is created (you will lose local settings)."),
      requireLogin: undefined,
    };
  }
  const requireLogin = typeof r.value?.settings?.requireLogin === "boolean" ? r.value.settings.requireLogin : undefined;
  const keys = Object.keys(r.value || {}).length;
  const rl = requireLogin === undefined ? "unset" : String(requireLogin);
  return {
    result: mk(id, title, "ok", `${file} parses; ${keys} top-level collections; settings.requireLogin=${rl}.`),
    requireLogin,
  };
}

export function checkSqlite(ctx) {
  const id = "sqlite";
  const title = "zippymesh.db schema";
  const file = path.join(ctx.dataDir.dir, "zippymesh.db");

  if (!ctx.fs.existsSync(file)) {
    return { result: mk(id, title, "warn", `${file} not found — this looks like a first run.`, "Start the server once; the SQLite store and its tables are created on first use."), info: null };
  }

  const read = ctx.readSqlite(file);
  if (!read || read.available === false) {
    return {
      result: mk(id, title, "skip", `Could not open the database read-only: ${read?.error || "better-sqlite3 is not installed here"}.`, "Run the doctor from a directory where `npm install` has run, so better-sqlite3 is available."),
      info: null,
    };
  }
  const parts = [`${read.tableCount} tables`, `PRAGMA user_version=${read.userVersion}`];
  if (read.userVersion === 0) {
    return {
      result: mk(
        id,
        title,
        "warn",
        `${parts.join(", ")} — the schema carries no version stamp; migrations are applied idempotently (CREATE TABLE IF NOT EXISTS + per-column ALTER checks in src/lib/localDb.js).`,
        "Not actionable by an operator; tracked as a project gap (there is no way to tell a partially-migrated store from a current one)."
      ),
      info: read,
    };
  }
  return { result: mk(id, title, "ok", parts.join(", ") + "."), info: read };
}

export function checkTrustProxy(ctx) {
  const id = "trust-proxy";
  const title = "TRUST_PROXY";
  const raw = ctx.env.TRUST_PROXY;
  if (raw === undefined || String(raw).trim() === "") {
    return mk(id, title, "ok", "Unset — X-Forwarded-For / X-Real-IP are ignored (the safe default).");
  }
  const v = String(raw).trim().toLowerCase();
  if (v === "1" || v === "true") {
    return mk(
      id,
      title,
      "warn",
      "Enabled — proxy address headers are trusted for vault rate-limit buckets.",
      "Correct ONLY when a reverse proxy you control rewrites those headers; otherwise unset TRUST_PROXY."
    );
  }
  return mk(
    id,
    title,
    "warn",
    `Set to an unrecognised value; only "1" and "true" enable proxy trust, so this is being treated as disabled.`,
    'Use `TRUST_PROXY=1` if you meant to enable it, or remove the variable.'
  );
}

export function checkRouterConfig(ctx) {
  const id = "router-config";
  const title = "router-config.json";
  const userDir = resolveUserConfigDir({ env: ctx.env, platform: ctx.platform, homedir: ctx.homedir });
  const userFile = path.join(userDir, "router-config.json");
  const dataFile = path.join(ctx.dataDir.dir, "router-config.json");

  const inUserDir = ctx.fs.existsSync(userFile);
  const inDataDir = userFile !== dataFile && ctx.fs.existsSync(dataFile);

  if (!inUserDir && !inDataDir) {
    return mk(id, title, "warn", `Not found in ${userDir}.`, "Run `npm run setup` to generate the persistent JWT_SECRET / SIDE_CAR_SECRET store.");
  }
  const where = inUserDir ? userFile : dataFile;
  const note =
    userFile !== dataFile
      ? " Note: scripts/setup-env.mjs always writes the OS per-user directory and ignores DATA_DIR."
      : "";
  return mk(id, title, "ok", `Present at ${where} (contents not read).${note}`);
}

export function checkStandaloneBuild(ctx) {
  const id = "standalone-build";
  const title = "Standalone build";
  const server = path.join(ctx.cwd, ".next", "standalone", "server.js");
  if (!ctx.fs.existsSync(server)) {
    return mk(id, title, "warn", "No .next/standalone/server.js — nothing has been built here yet.", "Run `npm run build` (or `npm run build:standalone`) before starting the production server.");
  }
  let mtime;
  try {
    mtime = ctx.fs.statSync(server).mtime;
  } catch (e) {
    return mk(id, title, "warn", `.next/standalone/server.js exists but could not be stat'ed: ${e.code || e.message}`, "Check permissions on .next/, or rebuild.");
  }
  const headIso = ctx.gitHeadIso();
  if (!headIso) {
    return mk(id, title, "ok", `Built ${new Date(mtime).toISOString()} (no git HEAD to compare against).`);
  }
  const headMs = Date.parse(headIso);
  if (!Number.isFinite(headMs)) {
    return mk(id, title, "ok", `Built ${new Date(mtime).toISOString()} (git HEAD timestamp unparseable).`);
  }
  if (mtime.getTime() < headMs) {
    return mk(
      id,
      title,
      "warn",
      `Build is older than HEAD (built ${new Date(mtime).toISOString()}, HEAD committed ${new Date(headMs).toISOString()}).`,
      "Rebuild with `npm run build` so the running server matches the checked-out code."
    );
  }
  return mk(id, title, "ok", `Built ${new Date(mtime).toISOString()}, newer than HEAD (${new Date(headMs).toISOString()}).`);
}

/**
 * The bind host of the BUILT server.
 *
 * `.next/standalone/server.js` is regenerated by every `next build` from Next's
 * own template, whose default is `process.env.HOSTNAME || '0.0.0.0'`. Since
 * commit 4726f6da, `scripts/prepare-standalone.cjs` PREPENDS a preamble to that
 * file which resolves `ZIPPY_BIND_HOST > HOST > HOSTNAME > 127.0.0.1` — and
 * `prepare-standalone.cjs:96-103` FAILS THE BUILD if the patch cannot be
 * applied, so a bundle produced by `npm run build` either carries it or does not
 * exist.
 *
 * WHAT WAS WRONG (adversarial review 2026-08-30, item 16a / H-14): this check
 * detected the hardened bundle with `head.includes("resolveBindHost")`. The
 * preamble resolves the bind INLINE and never uses that identifier — verified
 * against the real artifact, `resolveBindHost` occurs 0 times in
 * `.next/standalone/server.js` — while the literal `0.0.0.0` DOES appear in the
 * first 4 KB, inside a comment. So the check fell through to the stock-template
 * branch and reported the opposite of the truth, escalating to a hard `fail`
 * (and exit 1, breaking the CI gate at docs/DOCTOR.md) exactly when
 * `requireLogin` is false — the moment the operator most needs a correct answer.
 * It also PASSED a genuinely stock template whose only mention of
 * `resolveBindHost` was in a comment.
 *
 * The detector is now `prepare-standalone.cjs`'s own idempotency sentinel,
 * `PREAMBLE_MARKER = 'ZippyMesh standalone preamble'`, which that script emits
 * verbatim into the head of every bundle it patches. `resolveBindHost` is still
 * accepted as a secondary marker so a hand-patched or repo-root-style entry is
 * not mis-reported — but both are now required to be OUTSIDE a comment, since a
 * comment is exactly how the old check was fooled in both directions.
 *
 * The check reads only the first 4 KB of the file, and only to look for markers.
 */

/**
 * Strip `//` line comments and block comments so a marker inside one cannot be
 * mistaken for code. Deliberately naive — it is a heuristic over a generated
 * file's prologue, not a JS parser — but it is enough to stop the two
 * false-verdict paths above, and stripping too much can only make the check more
 * conservative (an unrecognised head warns; it never silently passes).
 */
function stripJsComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

/**
 * MUST equal PREAMBLE_MARKER in scripts/prepare-standalone.cjs — that script
 * uses it as its idempotency sentinel and writes it verbatim into the head of
 * every bundle it patches. tests/unit/doctorChecks.test.js reads the real
 * script and asserts the two agree, so a rename there fails the suite here
 * rather than silently re-breaking this check.
 */
export const STANDALONE_PREAMBLE_MARKER = "ZippyMesh standalone preamble";
export function checkStandaloneBindHost(ctx, { requireLogin } = {}) {
  const id = "standalone-bind";
  const title = "Built server bind host";
  const server = path.join(ctx.cwd, ".next", "standalone", "server.js");
  if (!ctx.fs.existsSync(server)) {
    return mk(id, title, "skip", "No standalone build to inspect.", "Build first if you intend to run the production server.");
  }
  let head;
  try {
    head = String(ctx.fs.readFileSync(server, "utf8")).slice(0, 4000);
  } catch (e) {
    return mk(id, title, "skip", `Could not read the built server.js: ${e.code || e.message}`, "Check permissions on .next/standalone/.");
  }

  // The PRIMARY marker is prepare-standalone.cjs's own idempotency sentinel. It
  // lives in a banner comment by design — that is where the patcher writes it —
  // so it is matched against the RAW head, not the comment-stripped copy.
  // tests/unit/doctorChecks.test.js asserts this string still matches what
  // prepare-standalone.cjs emits, so a rename there fails the suite here.
  if (head.includes(STANDALONE_PREAMBLE_MARKER)) {
    return mk(
      id,
      title,
      "ok",
      "The built .next/standalone/server.js carries the ZippyMesh standalone preamble: it resolves ZIPPY_BIND_HOST > HOST > HOSTNAME > 127.0.0.1, so the default bind is loopback and ZIPPY_BIND_HOST/HOST are honoured."
    );
  }

  // Everything below reads CODE, not comments. The previous version of this
  // check matched a bare substring and was fooled in both directions by a
  // comment mentioning `0.0.0.0` or `resolveBindHost`.
  const code = stripJsComments(head);

  if (code.includes("resolveBindHost")) {
    return mk(id, title, "ok", "The built server.js uses resolveBindHost() — ZIPPY_BIND_HOST is honoured and the default is loopback.");
  }
  if (!code.includes("0.0.0.0")) {
    return mk(id, title, "warn", "Could not determine how the built server.js chooses its bind host.", "Inspect .next/standalone/server.js before exposing this node.");
  }

  const hostnameEnv = typeof ctx.env.HOSTNAME === "string" ? ctx.env.HOSTNAME.trim() : "";
  const effective = hostnameEnv || "0.0.0.0";
  if (isLoopbackHostLike(effective)) {
    return mk(
      id,
      title,
      "warn",
      `The built .next/standalone/server.js is Next's stock template (HOSTNAME || "0.0.0.0"); it ignores ZIPPY_BIND_HOST and HOST. HOSTNAME=${effective} keeps it on loopback for now.`,
      "Rebuild with `npm run build` (or re-apply the patch with `node scripts/prepare-standalone.cjs --patch-server <dir>`), which injects the loopback-first preamble."
    );
  }
  const status = requireLogin === false ? "fail" : "warn";
  return mk(
    id,
    title,
    status,
    `The built .next/standalone/server.js is Next's stock template: it binds ${effective} (HOSTNAME || "0.0.0.0") and ignores ZIPPY_BIND_HOST/HOST${requireLogin === false ? ", while settings.requireLogin is false" : ""}. A bundle produced by \`npm run build\` should never look like this — prepare-standalone.cjs fails the build rather than emit one.`,
    "Rebuild with `npm run build`, or re-apply the patch to an unpacked install with `node scripts/prepare-standalone.cjs --patch-server <dir>`. As a stop-gap, start it with HOSTNAME=127.0.0.1."
  );
}

/**
 * GET <url>/api/health. Returns the check plus the parsed payload so the vault
 * check can read it without a second request.
 */
export async function checkServer(ctx, url) {
  const id = "server";
  const title = "Server /api/health";
  const target = `${String(url).replace(/\/+$/, "")}/api/health`;
  let res;
  try {
    res = await ctx.fetch(target, { method: "GET", signal: ctx.timeoutSignal(ctx.httpTimeoutMs) });
  } catch (e) {
    return {
      result: mk(id, title, "warn", `${target} is not reachable (${describeFetchError(e)}).`, "Start the server (`npm start`, or `node .next/standalone/server.js`), or pass --url if it listens elsewhere."),
      payload: null,
    };
  }
  if (!res.ok) {
    return { result: mk(id, title, "fail", `${target} answered HTTP ${res.status}.`, "Check the server log; /api/health returns 500 when the provider store cannot be read."), payload: null };
  }
  let payload;
  try {
    payload = await res.json();
  } catch (e) {
    return { result: mk(id, title, "fail", `${target} answered 200 but the body is not JSON: ${e.message}`, "Something is intercepting the route (a proxy or captive portal?). Confirm --url points at ZippyMesh."), payload: null };
  }
  const bits = [
    `version=${payload.version ?? "?"}`,
    `uptime=${typeof payload.uptime === "number" ? Math.round(payload.uptime) + "s" : "?"}`,
    `providersConfigured=${payload.providersConfigured ?? "?"}`,
    `providersActive=${payload.providersActive ?? "?"}`,
    `providersRateLimited=${payload.providersRateLimited ?? "?"}`,
  ];
  if (payload.db) bits.push(`db.ok=${payload.db.ok}`, `db.schemaVersion=${payload.db.schemaVersion}`);
  if (payload.build) bits.push(`build.standalone=${payload.build.standalone}`, `build.nodeVersion=${payload.build.nodeVersion}`);
  if (payload.bindHost) bits.push(`loopbackOnly=${payload.bindHost.loopbackOnly}`);
  if (typeof payload.trustProxy === "boolean") bits.push(`trustProxy=${payload.trustProxy}`);
  const status = payload.ok === false ? "fail" : "ok";
  return {
    result: mk(id, title, status, `${target} -> ${res.status}; ${bits.join(", ")}.`, status === "fail" ? "The route reported ok:false; check the server log." : null),
    payload,
  };
}

export function checkVault(ctx, payload) {
  const id = "vault";
  const title = "Vault state";
  if (!payload) {
    return mk(id, title, "skip", "No /api/health payload — the server was not reachable.", "Start the server and re-run to see vault state.");
  }
  const v = payload.vault;
  if (!v || typeof v !== "object") {
    return mk(id, title, "warn", "/api/health did not report a `vault` object — the running server predates this field.", "Rebuild and restart so /api/health reports vault state.");
  }
  if (!v.initialized) {
    return mk(id, title, "warn", "Vault is not initialised (no verifier and no entries).", "Store your first secret via the Vault page; the master password is anchored on that first write.");
  }
  if (!v.unlocked) {
    return mk(id, title, "warn", "Vault is initialised but locked — token reads answer 401 `Vault is locked`.", "Unlock it in the UI (or POST /api/vault/unlock); the unlock lives in the server process and is lost on restart.");
  }
  return mk(id, title, "ok", "Vault is initialised and unlocked.");
}

/**
 * Local / LAN provider reachability. Base URLs come from the SQLite
 * provider_nodes table (where they actually live) and from db.json's
 * providerNodes / providerConnections arrays (the cloud/lowdb shape).
 * API keys are never read, printed or sent.
 */
export function collectLocalProviderUrls(ctx, sqliteInfo) {
  const urls = new Map(); // safeUrl -> label
  const add = (baseUrl, name) => {
    if (typeof baseUrl !== "string" || !baseUrl.trim()) return;
    if (!isLocalOrLanUrl(baseUrl)) return;
    const key = safeUrl(baseUrl);
    if (!urls.has(key)) urls.set(key, name || "(unnamed)");
  };

  for (const n of sqliteInfo?.localNodes ?? []) add(n.baseUrl, n.name);

  const db = readJsonSafe(ctx, path.join(ctx.dataDir.dir, "db.json")).value;
  for (const n of db?.providerNodes ?? []) add(n.baseUrl, n.name);
  for (const c of db?.providerConnections ?? []) {
    add(c.baseUrl, c.name);
    add(c.metadata?.baseUrl, c.name);
  }
  return [...urls.entries()].map(([url, name]) => ({ url, name }));
}

export async function checkProviders(ctx, sqliteInfo) {
  const id = "providers";
  const title = "Local provider reachability";
  const targets = collectLocalProviderUrls(ctx, sqliteInfo);
  if (targets.length === 0) {
    return mk(id, title, "skip", "No local or LAN provider base URLs are configured.", "Add an Ollama / LM Studio / llama.cpp node on the Providers page to route to your own hardware.");
  }

  const probes = await Promise.all(
    targets.map(async (t) => {
      try {
        const res = await ctx.fetch(t.url, { method: "GET", signal: ctx.timeoutSignal(ctx.providerTimeoutMs) });
        return { ...t, reachable: true, note: `HTTP ${res.status}` };
      } catch (e) {
        return { ...t, reachable: false, note: describeFetchError(e) };
      }
    })
  );

  const up = probes.filter((p) => p.reachable);
  const down = probes.filter((p) => !p.reachable);
  const lines = probes.map((p) => `  ${p.reachable ? "reachable  " : "unreachable"}  ${p.url}  (${p.name}; ${p.note})`);
  const summary = `${up.length}/${probes.length} reachable\n${lines.join("\n")}`;

  if (down.length === 0) return mk(id, title, "ok", summary);
  return mk(
    id,
    title,
    "warn",
    summary,
    "Start the local runtime (e.g. `ollama serve`), or remove the stale node on the Providers page — routing will skip an unreachable node."
  );
}

// ── orchestration ─────────────────────────────────────────────────────────────

/**
 * Run every check in order and return the array of results.
 * @param {object} ctx — see the module header for the injected shape.
 */
export async function runAllChecks(ctx) {
  const results = [];

  results.push(checkNodeVersion(ctx));
  results.push(checkContext(ctx));
  results.push(checkEnvFile(ctx));

  const dbJson = checkDbJson(ctx);
  results.push(checkBind(ctx, { requireLogin: dbJson.requireLogin }));
  results.push(checkPorts(ctx));
  results.push(checkDataDir(ctx));
  results.push(dbJson.result);

  const sqlite = checkSqlite(ctx);
  results.push(sqlite.result);

  results.push(checkTrustProxy(ctx));
  results.push(checkRouterConfig(ctx));
  results.push(checkStandaloneBuild(ctx));
  results.push(checkStandaloneBindHost(ctx, { requireLogin: dbJson.requireLogin }));

  const server = await checkServer(ctx, ctx.url);
  results.push(server.result);
  results.push(checkVault(ctx, server.payload));

  results.push(await checkProviders(ctx, sqlite.info));

  return results;
}

/** 1 when anything failed, else 0. Warnings do not fail the run. */
export function exitCodeFor(results) {
  return results.some((r) => r.status === "fail") ? 1 : 0;
}
