import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { initLocalProviderConnections, vaultListEntries, vaultMetaGet, getSqliteDb } from "@/lib/localDb";
import { isVaultUnlocked } from "@/lib/vault";
import { isTrustedProxy } from "@/lib/vaultRateLimit";
import { resolveBindHost, isLoopbackHost } from "@/lib/net/bindHost";
import path from "path";
import fs from "fs";

/**
 * GET /api/health — the supervisor endpoint.
 *
 * THIS ROUTE IS PUBLIC AND UNAUTHENTICATED (src/middleware.js lets it through)
 * and may be reachable from the LAN when the node is bound to 0.0.0.0. It must
 * therefore emit BOOLEANS, VERSIONS AND COUNTS ONLY:
 *
 *   - no filesystem paths (not even the data directory)
 *   - no hostnames, addresses or ports (loopbackOnly is a boolean, not an address)
 *   - no secrets, no vault entry names, no provider names or base URLs
 *
 * Every field that existed before is byte-identical; other tools poll them.
 * New fields are additive: vault, dataDir, trustProxy, bindHost, db, build.
 */

// One-time initialization flag
let _localProvidersInitialized = false;

async function ensureLocalProvidersInitialized() {
  if (_localProvidersInitialized) return;
  try {
    const synced = await initLocalProviderConnections();
    if (synced > 0) {
      console.log(`[Init] Synced ${synced} local provider connections`);
    }
    _localProvidersInitialized = true;
  } catch (error) {
    console.error("[Init] Error syncing local providers:", error.message);
  }
}

function getVersion() {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      return pkg.version || "unknown";
    }
  } catch (_) {}
  return "unknown";
}

/** Mirror of src/lib/localDb.js getUserDataDir(). Used only to test writability — never returned. */
function resolveDataDirPath() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const appName = process.env.ZIPPY_APP_NAME || "zippy-mesh";
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) return path.join(appData, appName);
    return path.join(process.env.USERPROFILE || "", "AppData", "Roaming", appName);
  }
  return path.join(process.env.HOME || "", `.${appName}`);
}

/**
 * `configured` — DATA_DIR was set explicitly (as opposed to the OS default).
 * `writable`   — a permission check only; this route never writes a file.
 */
function getDataDirStatus() {
  const status = { configured: Boolean(process.env.DATA_DIR), writable: false };
  try {
    fs.accessSync(resolveDataDirPath(), fs.constants.W_OK);
    status.writable = true;
  } catch (_) {}
  return status;
}

/**
 * initialized — the master password has been anchored (a verifier blob exists)
 *   or at least one entry is stored. Mirrors vault.js verifyVaultPassword():
 *   a vault with neither is "fresh" and accepts any password at setup.
 * unlocked — the in-process master password is held (lost on restart).
 * Entry names and counts are deliberately NOT reported.
 */
function getVaultStatus() {
  let initialized = false;
  try {
    if (vaultMetaGet("vault_verifier")) {
      initialized = true;
    } else {
      initialized = vaultListEntries().length > 0;
    }
  } catch (_) {}

  let unlocked = false;
  try {
    unlocked = isVaultUnlocked();
  } catch (_) {}

  return { initialized, unlocked };
}

/**
 * ok — the SQLite store opened and answered a query.
 * schemaVersion — PRAGMA user_version. It is 0 today: localDb.js migrates
 *   idempotently (CREATE TABLE IF NOT EXISTS + per-column ALTER checks) and
 *   never stamps a version. Reported so a supervisor can watch it change once
 *   versioning lands; null means the database could not be opened.
 */
function getDbStatus() {
  try {
    const db = getSqliteDb();
    if (!db) return { ok: false, schemaVersion: null };
    const version = db.pragma("user_version", { simple: true });
    return { ok: true, schemaVersion: typeof version === "number" ? version : (version ?? null) };
  } catch (_) {
    return { ok: false, schemaVersion: null };
  }
}

/** Loopback-only is a boolean on purpose: the bind address itself is not disclosed. */
function getBindHostStatus() {
  try {
    const host = resolveBindHost({
      ZIPPY_BIND_HOST: process.env.ZIPPY_BIND_HOST,
      HOST: process.env.HOST ?? process.env.HOSTNAME,
    });
    return { loopbackOnly: isLoopbackHost(host) };
  } catch (_) {
    return { loopbackOnly: false };
  }
}

function getBuildStatus() {
  let standalone = false;
  try {
    standalone = fs.existsSync(path.join(process.cwd(), ".next", "standalone", "server.js"));
  } catch (_) {}
  return { version: getVersion(), standalone, nodeVersion: process.version };
}

export async function GET() {
  // Ensure local providers are synced on first health check
  await ensureLocalProvidersInitialized();
  try {
    const connections = await getProviderConnections();
    const activeCount = connections.filter(c => c.testStatus === "active").length;

    const rateLimited = connections.filter(c => {
      const until = c.rateLimitedUntil ? new Date(c.rateLimitedUntil).getTime() : 0;
      return until > Date.now();
    }).length;

    return NextResponse.json({
      ok: true,
      status: "ok",
      service: "zippymesh",
      version: getVersion(),
      uptime: process.uptime(),
      providersConfigured: connections.length,
      providersActive: activeCount,
      providersRateLimited: rateLimited,
      timestamp: new Date().toISOString(),
      apiVersion: "v1",
      endpoints: {
        models: "/v1/models",
        chat: "/v1/chat/completions",
        providerStatus: "/api/provider-status",
        rateLimits: "/api/tokenbuddy/rate-limits?all=true"
      },
      // ── additive supervisor fields (booleans / versions / counts only) ──
      vault: getVaultStatus(),
      dataDir: getDataDirStatus(),
      trustProxy: isTrustedProxy(),
      bindHost: getBindHostStatus(),
      db: getDbStatus(),
      build: getBuildStatus()
    });
  } catch (error) {
    // The detail stays here, in the operator's log, and does not go on the wire.
    console.error("[health] Error:", error.message);
    // FIXED 2026-08-30 (adversarial review item 12 / audit F26): this used to
    // return `error.message`, and every failure path funnels through it —
    // getProviderConnections() -> getDb() -> a driver error such as
    // SQLITE_CANTOPEN, whose message carries the absolute data-directory path
    // (and therefore the OS username). That contradicts this file's own header:
    // "BOOLEANS, VERSIONS AND COUNTS ONLY ... no filesystem paths (not even the
    // data directory)".
    //
    // The message is now a fixed string. `code` is the driver's error class
    // (e.g. "SQLITE_CANTOPEN") — diagnostic, and never path-shaped, so an
    // operator reading a supervisor's capture still learns which failure it was.
    // The 200 payload above is untouched; no consumer reads this 500 body
    // (the doctor returns on !res.ok before parsing, CI and Docker use curl -f,
    // and the e2e suites assert only the 200 shape).
    return NextResponse.json(
      {
        ok: false,
        status: "error",
        service: "zippymesh",
        version: getVersion(),
        message: "health check failed",
        code: typeof error?.code === "string" ? error.code : null,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

/**
 * HEAD /api/health — supervisors and load balancers often probe with HEAD.
 * 200 when the store answers, 503 when it does not. No body (HEAD must not
 * have one), so nothing can leak here.
 */
export async function HEAD() {
  try {
    await getProviderConnections();
    return new Response(null, { status: 200 });
  } catch (_) {
    return new Response(null, { status: 503 });
  }
}
