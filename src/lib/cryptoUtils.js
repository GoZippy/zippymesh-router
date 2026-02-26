import crypto from "node:crypto";
import os from "node:os";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Get a derived key from a passphrase and salt
 * @param {string} passphrase 
 * @param {Buffer} salt 
 * @returns {Buffer}
 */
function deriveKey(passphrase, salt) {
    // 32 bytes for aes-256
    return crypto.scryptSync(passphrase, salt, 32);
}

/**
 * Get the default passphrase (machine-id based fallback)
 * @returns {string}
 */
function getDefaultPassphrase() {
    // Combine hostname, username, and platform for a machine-specific string
    const userInfo = os.userInfo();
    const machineId = os.hostname() + userInfo.username + os.platform();
    return crypto.createHash('sha256').update(machineId).digest('hex');
}

/**
 * Encrypt a string
 * @param {string} text 
 * @param {string} [passphrase] 
 * @returns {string} encrypted string (base64)
 */
export function encrypt(text, passphrase = getDefaultPassphrase()) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = deriveKey(passphrase, salt);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Structure: iv(12) | salt(16) | tag(16) | encrypted
    const result = Buffer.concat([iv, salt, tag, encrypted]);
    return result.toString('base64');
}

/**
 * Decrypt a string
 * @param {string} encryptedBase64 
 * @param {string} [passphrase] 
 * @returns {string} decrypted string
 */
export function decrypt(encryptedBase64, passphrase = getDefaultPassphrase()) {
    try {
        const data = Buffer.from(encryptedBase64, 'base64');

        const iv = data.subarray(0, IV_LENGTH);
        const salt = data.subarray(IV_LENGTH, IV_LENGTH + SALT_LENGTH);
        const tag = data.subarray(IV_LENGTH + SALT_LENGTH, IV_LENGTH + SALT_LENGTH + TAG_LENGTH);
        const encrypted = data.subarray(IV_LENGTH + SALT_LENGTH + TAG_LENGTH);

        const key = deriveKey(passphrase, salt);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
    } catch (error) {
        throw new Error("Decryption failed. Incorrect passphrase or corrupted data.");
    }
}
