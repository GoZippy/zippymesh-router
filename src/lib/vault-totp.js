/**
 * Vault TOTP — second factor for unlockVault().
 *
 * Adds RFC 6238 TOTP (Time-based One-Time Password) on top of the
 * existing passphrase-based unlock flow. Designed to integrate with
 * any standards-compliant authenticator app (Google Authenticator,
 * Authy, 1Password, Bitwarden, etc.).
 *
 * Architecture:
 *   - On enrollment: generate a 32-character base32 secret. Encrypt it
 *     with the user's vault passphrase (AES-256-GCM via the existing
 *     vault encryptor) and store in vault_meta as `totp_secret`.
 *     Generate 10 random one-time backup codes; store them as
 *     bcrypt-hashed entries in `totp_backup_codes_hashed`.
 *   - On unlock: user provides passphrase + 6-digit TOTP code (or one
 *     of the unused backup codes). Both must validate.
 *   - Backup codes are single-use; consumed when used.
 *
 * The TOTP secret is stored encrypted under the vault passphrase, so
 * the bare DB on disk is useless without the passphrase even if the
 * attacker has the SQLite file.
 *
 * Storage in `vault_meta`:
 *   key="totp_enabled"               value="1" or absent
 *   key="totp_secret_encrypted"      value=JSON{encrypted_value,salt,iv,tag}
 *   key="totp_backup_codes_hashed"   value=JSON [bcrypt-hash, ...]
 */

import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import { authenticator } from "otplib";
import bcrypt from "bcryptjs";
import {
  vaultMetaGet,
  vaultMetaSet,
  vaultMetaDelete,
} from "./localDb.js";

const ENC_ALGO = "aes-256-gcm";
const PBKDF2_ITER = 210_000;
const KEY_LEN = 32;
const DIGEST = "sha256";
const SALT_BYTES = 16;
const IV_BYTES = 12;

// otplib defaults: SHA1, 30s window, 6 digits — standard authenticator-app compatible
authenticator.options = { window: 1, digits: 6 };

// ── Internal: encrypt under passphrase (matches vault.js style) ──────────────

function deriveKey(password, salt) {
  return pbkdf2Sync(password, salt, PBKDF2_ITER, KEY_LEN, DIGEST);
}

function encryptString(plaintext, password) {
  const salt = randomBytes(SALT_BYTES);
  const iv   = randomBytes(IV_BYTES);
  const key  = deriveKey(password, salt);
  const cipher = createCipheriv(ENC_ALGO, key, iv);
  const enc  = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag  = cipher.getAuthTag();
  return JSON.stringify({
    encrypted_value: enc.toString("hex"),
    salt: salt.toString("hex"),
    iv:   iv.toString("hex"),
    tag:  tag.toString("hex"),
  });
}

function decryptString(payload, password) {
  const obj = JSON.parse(payload);
  const key     = deriveKey(password, Buffer.from(obj.salt, "hex"));
  const iv      = Buffer.from(obj.iv, "hex");
  const tag     = Buffer.from(obj.tag, "hex");
  const enc     = Buffer.from(obj.encrypted_value, "hex");
  const decipher = createDecipheriv(ENC_ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

// ── Public API ───────────────────────────────────────────────────────────────

export function isTotpEnabled() {
  return vaultMetaGet("totp_enabled") === "1";
}

/**
 * Begin TOTP enrollment. Generates a fresh secret + 10 backup codes.
 *
 * Returns { ok, secret, otpauthUrl, backupCodes } so the UI can show a
 * QR code (otpauthUrl encoded into a QR) and display the backup codes
 * to the user ONCE — they must save them in a physical safe before
 * confirming. Confirmation calls confirmTotpEnrollment() with a 6-digit
 * code from the user's authenticator to verify enrollment was successful.
 *
 * The secret is NOT yet persisted at this stage — only after
 * confirmTotpEnrollment() succeeds.
 */
export function beginTotpEnrollment({ accountLabel = "ZippyVault", issuer = "ZippyMesh" } = {}) {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(accountLabel, issuer, secret);
  const backupCodes = generateBackupCodes(10);
  return {
    ok: true,
    secret,
    otpauthUrl,
    backupCodes, // shown to user ONCE
  };
}

/**
 * Confirm TOTP enrollment. Validates the user-supplied code against the
 * pending secret, then encrypts and persists both the secret and the
 * bcrypt-hashed backup codes. After this returns ok, future unlocks
 * require TOTP.
 */
export function confirmTotpEnrollment({ password, secret, code, backupCodes }) {
  if (!password || !secret || !code || !Array.isArray(backupCodes)) {
    return { ok: false, error: "missing field" };
  }
  // Validate the code BEFORE persisting — proves the user scanned the QR right
  if (!authenticator.check(String(code), secret)) {
    return { ok: false, error: "Code did not match. Try again with the current code from your authenticator." };
  }
  // Hash backup codes (bcrypt with reasonable cost — 10 rounds)
  const hashed = backupCodes.map(c => bcrypt.hashSync(c, 10));

  // Persist (secret encrypted under vault passphrase)
  vaultMetaSet("totp_secret_encrypted", encryptString(secret, password));
  vaultMetaSet("totp_backup_codes_hashed", JSON.stringify(hashed));
  vaultMetaSet("totp_enabled", "1");

  return { ok: true };
}

/**
 * Disable TOTP. Requires the current passphrase + a valid current TOTP
 * code (so a session-token-stealing attacker can't unilaterally disable
 * 2FA).
 */
export function disableTotp({ password, code }) {
  const secret = decryptStoredTotpSecret(password);
  if (!secret) return { ok: false, error: "Could not decrypt TOTP secret — wrong passphrase?" };
  if (!authenticator.check(String(code), secret)) {
    return { ok: false, error: "Invalid TOTP code." };
  }
  vaultMetaDelete("totp_secret_encrypted");
  vaultMetaDelete("totp_backup_codes_hashed");
  vaultMetaDelete("totp_enabled");
  return { ok: true };
}

/**
 * Verify a TOTP code (or a backup code) against the stored secret.
 * Used during unlockVault() if TOTP is enabled.
 *
 * Returns { ok: true } or { ok: false, error }.
 * Backup-code consumption: if the supplied code matches a hashed
 * backup code, that hash is removed from storage so it can't be reused.
 */
export function verifyTotpForUnlock({ password, code }) {
  if (!isTotpEnabled()) return { ok: true }; // TOTP disabled
  if (!code) return { ok: false, error: "TOTP code required" };

  // Try TOTP first
  const secret = decryptStoredTotpSecret(password);
  if (!secret) return { ok: false, error: "Could not unwrap TOTP secret. Wrong passphrase?" };

  if (authenticator.check(String(code), secret)) {
    return { ok: true };
  }

  // Try backup codes
  const hashedJson = vaultMetaGet("totp_backup_codes_hashed");
  if (hashedJson) {
    const hashes = JSON.parse(hashedJson);
    for (let i = 0; i < hashes.length; i++) {
      if (bcrypt.compareSync(String(code), hashes[i])) {
        // Consume this code
        hashes.splice(i, 1);
        vaultMetaSet("totp_backup_codes_hashed", JSON.stringify(hashes));
        return { ok: true, backup_code_used: true, backup_codes_remaining: hashes.length };
      }
    }
  }

  return { ok: false, error: "Invalid TOTP or backup code." };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function decryptStoredTotpSecret(password) {
  const enc = vaultMetaGet("totp_secret_encrypted");
  if (!enc) return null;
  try {
    return decryptString(enc, password);
  } catch {
    return null;
  }
}

function generateBackupCodes(count) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    // 10 hex chars = 40 bits of entropy per code — plenty for one-time use
    const buf = randomBytes(5);
    codes.push(buf.toString("hex"));
  }
  return codes;
}
