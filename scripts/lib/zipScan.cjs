/**
 * Read a zip's entry names, in Node, with no shell and no dependencies.
 *
 * WHY THIS EXISTS (adversarial review 2026-08-30 — security/install slice, C-2):
 * scripts/package-release.cjs verified its own release archive by shelling out.
 * On Windows the check was INERT. The regex was a JS string interpolated into a
 * PowerShell single-quoted literal, and the whole command was then passed
 * through JSON.stringify, which doubles every backslash. PowerShell reads `\\`
 * inside '...' literally, so .NET regex saw "a literal backslash followed by any
 * character" and every alternative containing `\.` became unmatchable — `.env`,
 * `bootstrap.secret`, `db.json`, `oauth-secrets.json`, `router-config.json`.
 * Five of the six guards were dead; only `data/` matched, and even that failed
 * whenever Compress-Archive emitted backslash separators. On POSIX the trailing
 * `|| true` covered the whole pipeline, so a host without `unzip` also passed.
 *
 * Nothing had actually leaked, but "we scan the zip" was not true on the
 * platform releases are built on.
 *
 * Kept in its own module so the gate can be unit-tested without executing the
 * packaging script's top-level side effects.
 */
const fs = require("fs");

/**
 * Never publish an archive containing these.
 *
 * Anchored at the ARCHIVE ROOT on purpose: the secrets all live at the top level
 * of the bundle, and an unanchored pattern produces false positives from
 * vendored files — `node_modules/caniuse-lite/data/...` alone matches a bare
 * `data/`. `.env` is anchored with `$` so `.env.example`, which SHOULD ship, is
 * not flagged.
 */
const LEAK_PATTERN =
  /^(\.env$|data\/|bootstrap\.secret|db\.json|oauth-secrets\.json|router-config\.json)/;

/**
 * Entry names in a zip, read from its End Of Central Directory record.
 *
 * Only the central directory is parsed — nothing is decompressed — so this is
 * O(entries) and never materialises file contents. Separators are normalised to
 * `/`, because Compress-Archive's behaviour varies by PowerShell major version
 * and the gate must not depend on which one built the archive.
 *
 * @param {string} file path to a .zip
 * @returns {string[]} entry names, `/`-separated
 * @throws if the file is not a readable zip. A throw must FAIL the release —
 *   "could not verify" is not "verified".
 */
function zipEntryNames(file) {
  const buf = fs.readFileSync(file);

  // EOCD: signature 0x06054b50, 22 bytes + up to 65535 bytes of trailing comment.
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`not a zip file (no end-of-central-directory record): ${file}`);

  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64: the 32-bit fields saturate and the real values live in the ZIP64 EOCD
  // record pointed at by the ZIP64 locator immediately before the EOCD. The
  // standalone bundle is ~3600 entries today, but node_modules only grows.
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || buf.readUInt32LE(locator) !== 0x07064b50) {
      throw new Error(`zip declares ZIP64 but carries no ZIP64 locator: ${file}`);
    }
    const z64 = Number(buf.readBigUInt64LE(locator + 8));
    if (buf.readUInt32LE(z64) !== 0x06064b50) {
      throw new Error(`zip64 end-of-central-directory record not found: ${file}`);
    }
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
  }

  const names = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`corrupt central directory at entry ${i} of ${file}`);
    }
    const nameLen  = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen   = buf.readUInt16LE(p + 32);
    names.push(buf.toString("utf8", p + 46, p + 46 + nameLen).replace(/\\/g, "/"));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return names;
}

/**
 * Entries in `file` that must never ship.
 *
 * @param {string} file path to a .zip
 * @returns {{ entries: string[], leaked: string[] }}
 */
function scanZipForLeaks(file) {
  const entries = zipEntryNames(file);
  return { entries, leaked: entries.filter((n) => LEAK_PATTERN.test(n)) };
}

module.exports = { LEAK_PATTERN, zipEntryNames, scanZipForLeaks };
