/**
 * ZippyVault — local encrypted credential store
 *
 * Encryption: AES-256-GCM
 * Key derivation: PBKDF2-SHA256, 600,000 iterations (OWASP recommended for
 *   SHA-256). Legacy 210k blobs remain readable and are re-wrapped on write.
 * Each entry has its own random salt so the same password produces different keys per entry.
 *
 * The vault is "unlocked" by calling unlockVault(password), which stores the
 * password in a module-level variable for the lifetime of the server process.
 * Call lockVault() to clear it.
 */

import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from "crypto";
import {
  vaultListEntries,
  vaultStoreEntry,
  vaultGetEntry,
  vaultDeleteEntry,
  vaultMetaGet,
  vaultMetaSet,
} from "./localDb.js";
import { isTotpEnabled, verifyTotpForUnlock } from "./vault-totp.js";

const ALGO        = "aes-256-gcm";
// OWASP 2023 PBKDF2-SHA256 recommendation is 600k (210k was the SHA-512
// figure). New blobs use 600k; the iteration count is version-tagged into the
// salt field so pre-existing 210k entries still decrypt and are transparently
// re-wrapped at 600k the next time they're written.
const ITERATIONS        = 600_000;
const LEGACY_ITERATIONS = 210_000;
const KEY_LEN     = 32;
const DIGEST      = "sha256";
const SALT_BYTES  = 16;
const IV_BYTES    = 12;

/** Known plaintext sealed under the master password to anchor it at init. */
const VERIFIER_PLAINTEXT = "zippy-vault-verifier-v1";
const VERIFIER_META_KEY  = "vault_verifier";

/** Module-level session — cleared on process restart or explicit lock */
let _vaultPassword = null;

/**
 * Unlock the vault.
 *
 * @param {string} password — the vault passphrase
 * @param {object} [opts]
 * @param {string} [opts.totpCode] — required if TOTP is enrolled (6-digit
 *   code OR an unused 10-character backup code)
 *
 * Returns { ok: true } or { ok: false, error, requires_totp? }.
 */
export function unlockVault(password, opts = {}) {
  if (!password || typeof password !== "string" || password.length < 1) {
    return { ok: false, error: "Password is required" };
  }
  // If TOTP is enrolled, require a valid second factor
  if (isTotpEnabled()) {
    if (!opts.totpCode) {
      return { ok: false, error: "TOTP code required", requires_totp: true };
    }
    const totp = verifyTotpForUnlock({ password, code: opts.totpCode });
    if (!totp.ok) return { ok: false, error: totp.error };
    if (totp.backup_code_used) {
      // Side-channel notice that a backup code was used (consumed)
      _lastUnlockNotice = `Backup code consumed. ${totp.backup_codes_remaining} remaining — regenerate before you run out.`;
    }
  }
  _vaultPassword = password;
  return { ok: true, notice: _lastUnlockNotice };
}

let _lastUnlockNotice = null;

export function lockVault() {
  _vaultPassword = null;
}

export function isVaultUnlocked() {
  return _vaultPassword !== null;
}

// ── Internal crypto helpers ───────────────────────────────────────────────────

function deriveKey(password, salt, iterations) {
  return pbkdf2Sync(password, salt, iterations, KEY_LEN, DIGEST);
}

/**
 * Parse the stored salt field. New format is `pbkdf2$<iterations>$<hexSalt>`;
 * a bare hex string is a legacy (210k) blob.
 */
function parseSalt(saltField) {
  if (typeof saltField === "string" && saltField.startsWith("pbkdf2$")) {
    const [, iterStr, hexSalt] = saltField.split("$");
    return { iterations: parseInt(iterStr, 10) || ITERATIONS, saltHex: hexSalt };
  }
  return { iterations: LEGACY_ITERATIONS, saltHex: saltField };
}

function encryptValue(plaintext, password) {
  const salt = randomBytes(SALT_BYTES);
  const iv   = randomBytes(IV_BYTES);
  const key  = deriveKey(password, salt, ITERATIONS);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc  = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag  = cipher.getAuthTag();
  return {
    encrypted_value: enc.toString("hex"),
    // Version-tag the iteration count so decrypt uses the right cost and old
    // blobs stay readable.
    salt: `pbkdf2$${ITERATIONS}$${salt.toString("hex")}`,
    iv:   iv.toString("hex"),
    tag:  tag.toString("hex"),
  };
}

function decryptValue(entry, password) {
  const { iterations, saltHex } = parseSalt(entry.salt);
  const key     = deriveKey(password, Buffer.from(saltHex, "hex"), iterations);
  const iv      = Buffer.from(entry.iv, "hex");
  const tag     = Buffer.from(entry.tag, "hex");
  const enc     = Buffer.from(entry.encrypted_value, "hex");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** Read the master-password verifier blob from vault_meta, or null. */
function getVerifier() {
  const raw = vaultMetaGet(VERIFIER_META_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Anchor the master password: seal a known plaintext under `password` if no
 * verifier exists yet. Called when the first secret is stored so a later
 * (post-delete) empty vault can't be unlocked with an arbitrary password.
 */
function ensureVerifier(password) {
  if (getVerifier()) return;
  vaultMetaSet(VERIFIER_META_KEY, JSON.stringify(encryptValue(VERIFIER_PLAINTEXT, password)));
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List all vault entries (metadata only, no values). Vault does not need to be unlocked. */
export function listVaultEntries() {
  return vaultListEntries().map(e => ({
    name:       e.name,
    label:      e.label,
    category:   e.category,
    tags:       e.tags ? JSON.parse(e.tags) : [],
    created_at: e.created_at,
    updated_at: e.updated_at,
  }));
}

/**
 * Store or update a vault entry.
 * Vault must be unlocked.
 */
export function storeVaultEntry(name, value, { label, category, tags } = {}) {
  if (!_vaultPassword) return { ok: false, error: "Vault is locked" };
  if (!name || typeof name !== "string") return { ok: false, error: "name is required" };
  if (value === undefined || value === null) return { ok: false, error: "value is required" };

  // Anchor the master password on first write so the vault can never again be
  // "unlocked" with an arbitrary password (even after all entries are deleted).
  ensureVerifier(_vaultPassword);

  const crypto = encryptValue(String(value), _vaultPassword);
  vaultStoreEntry({
    name,
    label: label || name,
    category: category || "api-key",
    ...crypto,
    tags: tags ? JSON.stringify(tags) : null,
  });
  return { ok: true };
}

/**
 * Read a vault entry's plaintext value.
 * Vault must be unlocked.
 */
export function readVaultEntry(name) {
  // `code` is the machine-readable failure class; callers map it to a status
  // without matching on message text (which interpolates caller input).
  if (!_vaultPassword) return { ok: false, error: "Vault is locked", code: "locked" };
  const entry = vaultGetEntry(name);
  if (!entry) return { ok: false, error: `Entry not found: ${name}`, code: "not_found" };
  try {
    const value = decryptValue(entry, _vaultPassword);
    return { ok: true, name: entry.name, label: entry.label, category: entry.category, value };
  } catch {
    return { ok: false, error: "Decryption failed — wrong password?", code: "decrypt_failed" };
  }
}

/**
 * Delete a vault entry (does not need to be unlocked).
 */
export function deleteVaultEntry(name) {
  const changes = vaultDeleteEntry(name);
  return { ok: changes > 0, deleted: changes > 0 };
}

/**
 * Verify the password is the vault's master password.
 *
 * Prefers the anchored verifier blob (set at first write), so an
 * initialized-but-now-empty vault still rejects arbitrary passwords. Falls
 * back to decrypting the first entry for legacy vaults created before the
 * verifier existed. Only a truly-fresh vault (no verifier, no entries) accepts
 * any password — that's the initial-setup case, with no secrets yet to protect.
 */
export function verifyVaultPassword(password) {
  const verifier = getVerifier();
  if (verifier) {
    try {
      return decryptValue(verifier, password) === VERIFIER_PLAINTEXT;
    } catch {
      return false;
    }
  }
  const entries = vaultListEntries();
  if (entries.length === 0) return true;
  const entry = vaultGetEntry(entries[0].name);
  if (!entry) return true;
  try {
    decryptValue(entry, password);
    return true;
  } catch {
    return false;
  }
}
