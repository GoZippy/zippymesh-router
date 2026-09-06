/**
 * Copy a standalone build into a bundle tree without carrying secrets into it.
 *
 * WHY (adversarial review 2026-08-30, item 16e): scripts/build-tauri-frontend.cjs
 * used to `fs.cpSync(.next/standalone -> src-tauri/resources/standalone)`
 * wholesale, and `next build` copies the repo-root `.env` into
 * `.next/standalone/.env`. `tauri.conf.json` bundles
 * `"resources/standalone/**\/*"`, so an installer would carry the builder's
 * `.env` — and a CI build (whose `prebuild` mints a fresh one) would bake ONE
 * shared JWT_SECRET into every copy, letting anyone holding the installer forge
 * a session cookie for any install of it. `data/` — optionally a symlink at the
 * operator's real store — would ship the same way, and `cpSync` dereferences.
 *
 * Same guard list as the release zip's gate (scripts/lib/zipScan.cjs), applied
 * at copy time instead of after the fact.
 */
const fs = require("fs");
const path = require("path");

/**
 * Never copied into a bundle, at ANY depth.
 *
 * `.env.example` MUST still ship — the bundled README tells the user to copy it
 * — so this is an exact-name match, never a prefix.
 */
const EXCLUDE_NAMES = new Set([
  ".env",
  "bootstrap.secret",
  "data",
  "db.json",
  "oauth-secrets.json",
  "router-config.json",
]);

/** Post-copy assertion: a bundle containing any of these must not be shipped. */
const LEAK_NAME_RE = /^(\.env|bootstrap\.secret|db\.json|oauth-secrets\.json|router-config\.json)$/;

/**
 * Recursive copy that drops EXCLUDE_NAMES and never dereferences a symlink.
 *
 * @param {string} src
 * @param {string} dest
 * @param {(msg: string) => void} [log]
 * @returns {{ copied: number, excluded: string[], skippedLinks: string[] }}
 */
function copyFiltered(src, dest, log = () => {}) {
  const stats = { copied: 0, excluded: [], skippedLinks: [] };

  (function walk(from, to, rel) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (EXCLUDE_NAMES.has(entry.name)) {
        stats.excluded.push(relPath);
        log(`Excluded from the bundle: ${relPath}`);
        continue;
      }
      const s = path.join(from, entry.name);
      const d = path.join(to, entry.name);
      if (entry.isSymbolicLink()) {
        stats.skippedLinks.push(relPath);
        log(`Skipped symlink (never dereferenced): ${relPath}`);
        continue;
      }
      if (entry.isDirectory()) walk(s, d, relPath);
      else if (entry.isFile()) { fs.copyFileSync(s, d); stats.copied++; }
    }
  })(src, dest, "");

  return stats;
}

/**
 * Every secret-shaped filename under `dir`, relative to it.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function findLeakedNames(dir) {
  const found = [];
  (function scan(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { scan(full); continue; }
      if (LEAK_NAME_RE.test(entry.name)) found.push(path.relative(dir, full).replace(/\\/g, "/"));
    }
  })(dir);
  return found;
}

module.exports = { EXCLUDE_NAMES, LEAK_NAME_RE, copyFiltered, findLeakedNames };
