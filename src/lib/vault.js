/**
 * ZippyVault — local encrypted credential store
 *
 * Encryption: AES-256-GCM
 * Key derivation: PBKDF2-SHA256, 210,000 iterations (OWASP recommended)
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
} from "./localDb.js";

const ALGO        = "aes-256-gcm";
const ITERATIONS  = 210_000;
const KEY_LEN     = 32;
const DIGEST      = "sha256";
const SALT_BYTES  = 16;
const IV_BYTES    = 12;

/** Module-level session — cleared on process restart or explicit lock */
let _vaultPassword = null;

export function unlockVault(password) {
  if (!password || typeof password !== "string" || password.length < 1) {
    return { ok: false, error: "Password is required" };
  }
  _vaultPassword = password;
  return { ok: true };
}

export function lockVault() {
  _vaultPassword = null;
}

export function isVaultUnlocked() {
  return _vaultPassword !== null;
}

// ── Internal crypto helpers ───────────────────────────────────────────────────

function deriveKey(password, salt) {
  return pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST);
}

function encryptValue(plaintext, password) {
  const salt = randomBytes(SALT_BYTES);
  const iv   = randomBytes(IV_BYTES);
  const key  = deriveKey(password, salt);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc  = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag  = cipher.getAuthTag();
  return {
    encrypted_value: enc.toString("hex"),
    salt: salt.toString("hex"),
    iv:   iv.toString("hex"),
    tag:  tag.toString("hex"),
  };
}

function decryptValue(entry, password) {
  const key     = deriveKey(password, Buffer.from(entry.salt, "hex"));
  const iv      = Buffer.from(entry.iv, "hex");
  const tag     = Buffer.from(entry.tag, "hex");
  const enc     = Buffer.from(entry.encrypted_value, "hex");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
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
  if (!_vaultPassword) return { ok: false, error: "Vault is locked" };
  const entry = vaultGetEntry(name);
  if (!entry) return { ok: false, error: `Entry not found: ${name}` };
  try {
    const value = decryptValue(entry, _vaultPassword);
    return { ok: true, name: entry.name, label: entry.label, category: entry.category, value };
  } catch {
    return { ok: false, error: "Decryption failed — wrong password?" };
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
 * Verify the current password is correct by attempting to decrypt the first entry.
 * Returns true if vault is empty (no entries to check against).
 */
export function verifyVaultPassword(password) {
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
