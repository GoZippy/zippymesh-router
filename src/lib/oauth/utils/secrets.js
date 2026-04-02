/**
 * Shared OAuth Secret Utilities
 * Centralized handling for OAuth client secrets with fallback validation
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

/**
 * Check if a client secret is usable (not redacted, not a placeholder)
 * @param {string} secret - The secret to validate
 * @returns {boolean} - True if the secret is usable
 */
export function isUsableClientSecret(secret) {
  if (typeof secret !== "string") return false;
  const value = secret.trim();
  if (!value) return false;
  const upper = value.toUpperCase();
  return !upper.includes("REDACTED") && !upper.includes("PLACEHOLDER");
}

/**
 * Get the persistent user data directory (survives rebuilds).
 * Mirrors the logic in src/lib/localDb.js so secrets persist alongside tokens.
 *   Windows : %APPDATA%\zippy-mesh\
 *   Linux/Mac: ~/.zippy-mesh/
 */
function getUserDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const appName = process.env.ZIPPY_APP_NAME || "zippy-mesh";
  if (process.platform === "win32") {
    return `${process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")}\\${appName}`;
  }
  return `${os.homedir()}/.${appName}`;
}

const OAUTH_SECRET_FILE = "oauth-secrets.json";
const OAUTH_SECRET_KEY_FILE = "oauth-secrets.key";

function getStoredSecretKey() {
  try {
    const dir = getUserDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const keyPath = path.join(dir, OAUTH_SECRET_KEY_FILE);
    if (fs.existsSync(keyPath)) {
      const payload = JSON.parse(fs.readFileSync(keyPath, "utf8"));
      const raw = typeof payload?.key === "string" ? payload.key.trim() : "";
      const parsed = raw ? Buffer.from(raw, "base64") : null;
      if (parsed && parsed.length === 32) {
        return parsed;
      }
    }

    const generated = crypto.randomBytes(32);
    fs.writeFileSync(
      keyPath,
      JSON.stringify({
        key: generated.toString("base64"),
        createdAt: new Date().toISOString(),
      }),
      "utf8"
    );
    return generated;
  } catch {
    return null;
  }
}

function getSecretKey() {
  const configured = process.env.ZIPPY_OAUTH_SECRET_KEY?.trim();
  if (configured) {
    try {
      const parsed = Buffer.from(configured, "base64");
      if (parsed.length === 32) return parsed;
      return crypto.createHash("sha256").update(configured).digest();
    } catch {
      return crypto.createHash("sha256").update(configured).digest();
    }
  }
  return getStoredSecretKey();
}

function encodeSecretPayload(secret) {
  try {
    const key = getSecretKey();
    if (!key) return secret;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      value: encrypted.toString("base64"),
    };
  } catch {
    return secret;
  }
}

function decodeSecretPayload(entry) {
  if (typeof entry !== "object" || entry === null) return null;
  if (entry.version !== 1 || entry.algorithm !== "aes-256-gcm") return null;

  try {
    const key = getSecretKey();
    if (!key) return null;

    const iv = Buffer.from(entry.iv || "", "base64");
    const tag = Buffer.from(entry.tag || "", "base64");
    const encrypted = Buffer.from(entry.value || "", "base64");
    if (!iv.length || !tag.length || !encrypted.length) return null;

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    return isUsableClientSecret(plaintext) ? plaintext.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Read a client secret from the persistent secrets store in the user data dir.
 * File: {DATA_DIR}/oauth-secrets.json  e.g. { "antigravity": "GOCSpx-..." }
 * Writing to this file is done via saveOAuthClientSecret().
 */
function readSecretFromDataDir(providerName) {
  try {
    const secretsFile = path.join(getUserDataDir(), OAUTH_SECRET_FILE);
    if (!fs.existsSync(secretsFile)) return null;
    const data = JSON.parse(fs.readFileSync(secretsFile, "utf8"));
    const secret = data?.[providerName];
    if (typeof secret === "string") {
      if (!isUsableClientSecret(secret)) return null;
      const plain = secret.trim();
      const migrated = encodeSecretPayload(plain);
      if (typeof migrated === "object" && migrated.version) {
        data[providerName] = migrated;
        fs.writeFileSync(secretsFile, JSON.stringify(data, null, 2), "utf8");
      }
      return plain;
    }
    return decodeSecretPayload(secret);
  } catch {
    return null;
  }
}

/**
 * Persist a client secret to the user data dir so it survives rebuilds.
 * @param {string} providerName - e.g. 'antigravity'
 * @param {string} secret - The client secret value
 */
export function saveOAuthClientSecret(providerName, secret) {
  try {
    const dir = getUserDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const secretsFile = path.join(dir, OAUTH_SECRET_FILE);
    const existing = fs.existsSync(secretsFile)
      ? JSON.parse(fs.readFileSync(secretsFile, "utf8"))
      : {};
    existing[providerName] = encodeSecretPayload(secret);
    fs.writeFileSync(secretsFile, JSON.stringify(existing, null, 2), "utf8");
  } catch (err) {
    console.warn(`[secrets] Failed to persist client secret for ${providerName}:`, err.message);
  }
}

function getClientSecretFromConnection(providerName, connection) {
  if (!connection || typeof connection !== "object") return null;
  const metadata = connection.providerSpecificData || connection.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const perProvider = metadata.oauth?.[providerName];
  if (isUsableClientSecret(perProvider?.clientSecret)) {
    return perProvider.clientSecret.trim();
  }
  if (isUsableClientSecret(metadata.oauth?.clientSecret)) {
    return metadata.oauth.clientSecret.trim();
  }
  if (isUsableClientSecret(metadata.clientSecret)) {
    return metadata.clientSecret.trim();
  }
  return null;
}

/**
 * Resolve OAuth client secret with layered fallback:
 *   1. Explicit secret from caller input (UI/manual exchange)
 *   2. Connection metadata (UI-provisioned, DB-persisted)
 *   3. Env var at startup (process config)
 *   4. Persistent user data directory (oauth-secrets.json)
 *   5. open-sse/config/constants.js fallback (self-hosted deployments)
 * @param {string} providerName - The provider name (e.g., 'antigravity', 'gemini-cli')
 * @param {object} config - The primary config object with clientSecret property
 * @returns {Promise<string|null>} - The resolved secret or null
 */
export async function resolveOAuthClientSecret(providerName, config, options = {}) {
  // 1. Explicit secret from UI/request payload
  if (isUsableClientSecret(options?.clientSecret)) {
    return options.clientSecret.trim();
  }

  // 2. Connection metadata (UI-provisioned, persisted in DB)
  const connectionSecret = getClientSecretFromConnection(providerName, options?.connection);
  if (connectionSecret) {
    saveOAuthClientSecret(providerName, connectionSecret);
    return connectionSecret;
  }

  // 3. Env var (startup config)
  if (isUsableClientSecret(config?.clientSecret)) {
    return config.clientSecret.trim();
  }

  // 4. Persistent user data dir — survives rebuilds without needing .env
  const persisted = readSecretFromDataDir(providerName);
  if (persisted) return persisted;

  // 5. Fallback to open-sse config for self-hosted deployments
  try {
    const path = (await import("path")).default;
    const { pathToFileURL } = await import("url");
    const constantsPath = path.join(process.cwd(), "open-sse", "config", "constants.js");
    const { PROVIDERS: OPEN_SSE_PROVIDERS } = await import(pathToFileURL(constantsPath).href);
    const fallback = OPEN_SSE_PROVIDERS?.[providerName]?.clientSecret;
    if (isUsableClientSecret(fallback)) {
      return fallback.trim();
    }
  } catch {
    // Optional fallback only; ignore if open-sse constants are unavailable.
  }

  return null;
}
