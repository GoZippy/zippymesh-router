#!/usr/bin/env node
/**
 * scripts/setup-env.mjs — generate/refresh the persistent bootstrap secrets.
 *
 * Runs standalone (`npm run setup`) and as the `predev` / `prebuild` hook, so it
 * MUST be side-effect-free when nothing needs to change: a verification run, a
 * build, or a `npm run dev` must never churn the operator's `.env` or
 * `router-config.json` mtimes, and must never weaken an existing password.
 *
 * Secrets live in `router-config.json` inside the app data directory. The data
 * directory is resolved exactly like `src/lib/localDb.js#getUserDataDir()`
 * (DATA_DIR wins; then %APPDATA%\<app>; then ~/.<app>) so a run with
 * DATA_DIR pointed at a throwaway directory cannot touch the real store.
 *
 * Flags / environment:
 *   --force                      rewrite .env from .env.example (destructive)
 *   --password=<pw>              set INITIAL_PASSWORD (never downgraded to the
 *                                built-in default; see maybeSetInitialPassword)
 *   --no-env                     do not read or write .env at all
 *   ZIPPY_SETUP_NO_ENV_WRITE=1   same as --no-env
 *   DATA_DIR                     where router-config.json lives
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

const args = process.argv.slice(2);
const force = args.some((a) => a === "--force");
const noEnv =
  args.some((a) => a === "--no-env") ||
  process.env.ZIPPY_SETUP_NO_ENV_WRITE === "1";
const passwordArg = args.find((a) => a.startsWith("--password="));
const password = passwordArg ? passwordArg.slice("--password=".length) : null;

/** The password used when an install has none and the operator supplied none. */
const DEFAULT_INITIAL_PASSWORD = "admin";

/** Every line this run prints, so the summary is one coherent block. */
const did = [];
const skipped = [];

/**
 * Resolve the app data directory.
 *
 * Kept byte-for-byte equivalent to `getUserDataDir()` in `src/lib/localDb.js`
 * (and to `getDataDir()` in `scripts/bootstrapEnv.cjs`). If you change the
 * resolution order, change it in all three — a mismatch means this script
 * writes secrets to a directory the server never reads, which is exactly the
 * bug this comment exists to prevent. Note that macOS deliberately uses
 * `~/.zippy-mesh`, NOT `~/Library/Application Support`, because localDb.js does.
 */
function getUserDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  const appName = process.env.ZIPPY_APP_NAME || "zippy-mesh";
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) return path.join(appData, appName);
    return path.join(os.homedir(), "AppData", "Roaming", appName);
  }
  return path.join(os.homedir(), `.${appName}`);
}

/**
 * Write `content` to `file` only if that would actually change the bytes on
 * disk. Returns true when a write happened.
 */
function writeIfChanged(file, content) {
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) {
      return false;
    }
  } catch {
    // Unreadable — fall through and write.
  }
  fs.writeFileSync(file, content, "utf8");
  return true;
}

/**
 * Decide the INITIAL_PASSWORD for this config, never downgrading.
 *
 * Rules, in order:
 *   1. No existing value  -> use --password, else the built-in default.
 *   2. No --password      -> keep what is there. A build/dev hook must never
 *                            touch a password the operator chose.
 *   3. --password equals the built-in default while a different, non-default
 *      password already exists -> refuse. That is a downgrade, and it would
 *      silently hand an install back to `admin`.
 *   4. Otherwise           -> honour the explicit --password.
 */
function maybeSetInitialPassword(existing) {
  if (!existing) {
    const value = password || DEFAULT_INITIAL_PASSWORD;
    if (!password) {
      did.push(
        `set INITIAL_PASSWORD to the built-in default ("${DEFAULT_INITIAL_PASSWORD}") — change it at /setup`
      );
    } else {
      did.push("set INITIAL_PASSWORD from --password");
    }
    return value;
  }
  if (!password) {
    skipped.push("INITIAL_PASSWORD (already set; no --password given)");
    return existing;
  }
  if (password === existing) {
    skipped.push("INITIAL_PASSWORD (--password matches the stored value)");
    return existing;
  }
  if (password === DEFAULT_INITIAL_PASSWORD && existing !== DEFAULT_INITIAL_PASSWORD) {
    skipped.push(
      `INITIAL_PASSWORD (refused to downgrade a set password to the default "${DEFAULT_INITIAL_PASSWORD}")`
    );
    return existing;
  }
  did.push("replaced INITIAL_PASSWORD from --password");
  return password;
}

// ── router-config.json ──────────────────────────────────────────────────────

const dataDir = getUserDataDir();
const configPath = path.join(dataDir, "router-config.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  did.push(`created data directory ${dataDir}`);
}

let osConfig = {};
if (fs.existsSync(configPath)) {
  try {
    osConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    console.warn(
      `[Setup] ${configPath} is not valid JSON — regenerating missing secrets without discarding the file's other keys is not possible; starting from empty.`
    );
    osConfig = {};
  }
}

if (!osConfig.JWT_SECRET) {
  osConfig.JWT_SECRET = crypto.randomBytes(32).toString("hex");
  did.push("generated JWT_SECRET");
} else {
  skipped.push("JWT_SECRET (already in router-config.json)");
}

// Shared bearer secret between the Next.js server and the Rust mesh sidecar
// (sidecar/src/main.rs `require_api_key`). The sidecar inherits it via env when
// spawned by zippy-node-manager.js; JS callers attach it via sidecarAuthHeaders()
// in src/lib/sidecar.js.
if (!osConfig.SIDE_CAR_SECRET) {
  osConfig.SIDE_CAR_SECRET = crypto.randomBytes(32).toString("hex");
  did.push("generated SIDE_CAR_SECRET");
} else {
  skipped.push("SIDE_CAR_SECRET (already in router-config.json)");
}

// HMAC key for router API keys served at /v1/* (src/shared/utils/apiKey.js,
// src/lib/auth/edgeApiKey.js). Without a persistent value the app falls back to
// an EPHEMERAL per-process secret and every issued key stops verifying on the
// next restart (install audit 2026-08-30, finding #22). Provisioned here and,
// for the .env-less standalone path, by scripts/bootstrapEnv.cjs.
if (!osConfig.API_KEY_SECRET) {
  osConfig.API_KEY_SECRET = crypto.randomBytes(32).toString("hex");
  did.push("generated API_KEY_SECRET");
} else {
  skipped.push("API_KEY_SECRET (already in router-config.json)");
}

osConfig.INITIAL_PASSWORD = maybeSetInitialPassword(osConfig.INITIAL_PASSWORD);

const configBody = JSON.stringify(osConfig, null, 2);
if (writeIfChanged(configPath, configBody)) {
  console.log(`[Setup] Wrote ${configPath}`);
} else {
  console.log(`[Setup] ${configPath} already up to date — not rewritten.`);
}

// ── .env ────────────────────────────────────────────────────────────────────

if (noEnv) {
  console.log(
    "[Setup] --no-env / ZIPPY_SETUP_NO_ENV_WRITE=1 — .env was not read or written."
  );
} else if (fs.existsSync(envPath) && !force) {
  // Sync only the values this script owns, and only into a MISSING or EMPTY
  // line. The operator's `.env` is authoritative for every one of these.
  //
  // FIXED 2026-08-30 (adversarial review — security/install slice, H-7): this
  // loop passed `keepExisting = false` for JWT_SECRET and SIDE_CAR_SECRET, so
  // whenever `.env` and router-config.json had diverged — a hand-edit, a backup
  // restore, an `.env` copied between machines — EVERY `npm run dev` and
  // `npm run build` (both hooks run this script) silently overwrote the
  // operator's `.env` value with router-config's. That invalidated every
  // dashboard session and made the running sidecar's shared bearer start 401ing
  // until restart, with no warning. And the summary line said
  // "Skipped: JWT_SECRET (already present)" — which refers to
  // router-config.json, not `.env`, so it read as the exact opposite of what
  // had just happened. That also contradicted this file's own docstring:
  // "must never churn the operator's `.env`".
  //
  // A divergence is now reconciled TOWARD `.env` (its value is written back to
  // router-config.json, which is the file nothing else owns) and reported.
  const before = fs.readFileSync(envPath, "utf8");
  let content = before;
  const adopted = [];
  const filled = [];

  for (const key of ["JWT_SECRET", "SIDE_CAR_SECRET", "API_KEY_SECRET"]) {
    const value = osConfig[key];
    const existing = content.match(new RegExp(`^${key}=(.*)$`, "m"));

    if (existing && existing[1].trim() !== "") {
      // The operator's .env wins. If router-config disagrees, adopt .env's
      // value there so the two stop drifting and the sidecar (which reads
      // router-config) agrees with the server (which reads .env).
      const envValue = existing[1].trim().replace(/^["'](.*)["']$/, "$1");
      if (envValue !== value) {
        osConfig[key] = envValue;
        adopted.push(key);
      }
      continue;
    }

    const line = `${key}=${value}`;
    if (existing) {
      content = content.replace(new RegExp(`^${key}=.*$`, "m"), line);
    } else {
      content += `${content.endsWith("\n") ? "" : "\n"}${line}\n`;
    }
    filled.push(key);
  }

  if (adopted.length) {
    console.log(
      `[Setup] .env already sets ${adopted.join(" + ")} to a different value than ${configPath}. ` +
        "Your .env wins — router-config.json has been updated to match it. " +
        "(Nothing in .env was changed.)"
    );
    const reconciled = JSON.stringify(osConfig, null, 2);
    if (writeIfChanged(configPath, reconciled)) {
      console.log(`[Setup] Reconciled ${configPath} to the .env values.`);
    }
  }

  if (writeIfChanged(envPath, content)) {
    console.log(`[Setup] Filled empty/missing ${filled.join(" + ")} line(s) in the existing .env.`);
  } else {
    console.log("[Setup] .env left untouched — every secret it sets is already populated.");
  }
} else {
  const envExisted = fs.existsSync(envPath);
  let content = fs.existsSync(examplePath)
    ? fs.readFileSync(examplePath, "utf8")
    // Fallback template only used if .env.example is missing. DATA_DIR is
    // intentionally omitted so the app falls back to the OS-conventional
    // per-user data dir (%APPDATA%\zippy-mesh / ~/.zippy-mesh) instead of
    // storing secrets inside the source tree. See .env.example for details.
    : `JWT_SECRET=REPLACE_ME\nSIDE_CAR_SECRET=REPLACE_ME\nAPI_KEY_SECRET=REPLACE_ME\n`;

  content = content.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${osConfig.JWT_SECRET}`);
  if (/^API_KEY_SECRET=.*$/m.test(content)) {
    content = content.replace(/^API_KEY_SECRET=.*$/m, `API_KEY_SECRET=${osConfig.API_KEY_SECRET}`);
  } else {
    content += `${content.endsWith("\n") ? "" : "\n"}API_KEY_SECRET=${osConfig.API_KEY_SECRET}\n`;
  }
  if (/^SIDE_CAR_SECRET=.*$/m.test(content)) {
    content = content.replace(
      /^SIDE_CAR_SECRET=.*$/m,
      `SIDE_CAR_SECRET=${osConfig.SIDE_CAR_SECRET}`
    );
  } else {
    content += `${content.endsWith("\n") ? "" : "\n"}SIDE_CAR_SECRET=${osConfig.SIDE_CAR_SECRET}\n`;
  }

  if (writeIfChanged(envPath, content)) {
    console.log(
      envExisted
        ? "[Setup] Rewrote .env from .env.example (--force)."
        : "[Setup] Created .env from .env.example."
    );
  } else {
    console.log("[Setup] .env already matches .env.example + stored secrets — not rewritten.");
  }
}

// ── summary ─────────────────────────────────────────────────────────────────

console.log(`[Setup] Data dir: ${dataDir}${process.env.DATA_DIR ? " (from DATA_DIR)" : ""}`);
if (did.length) console.log(`[Setup] Did:     ${did.join("; ")}`);
if (skipped.length) console.log(`[Setup] Skipped: ${skipped.join("; ")}`);
if (!did.length) console.log("[Setup] Nothing needed changing.");
