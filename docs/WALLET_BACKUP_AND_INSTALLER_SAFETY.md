# ZippyCoin wallet: backup, installer safety, and migrations

The app includes a ZippyCoin ecosystem wallet. User wallet and app data **must never be overwritten** by installers or updaters. Users must be able to **back up** their wallet, and **migrations** must be safe when we improve wallet or consensus logic.

---

## Where wallet and user data live

| Location | Contents | Used by |
|----------|----------|--------|
| **DATA_DIR** (platform-specific) | `zippymesh.db` (SQLite: providers, **wallets**, routing, model registry), `db.json`, usage logs, OAuth secrets | App dashboard, API, localDb |
| **~/.zippy** (or `%USERPROFILE%\.zippy` on Windows) | `wallet.json` — ZippyCoin mesh wallet (address, key material, version) | wallet-management.js, mesh infer/payment flows |

**DATA_DIR** defaults:

- Windows: `%APPDATA%\zippy-mesh`
- macOS: `~/Library/Application Support/zippy-mesh`
- Linux: `~/.zippy-mesh`

Override with the `DATA_DIR` environment variable.

---

## User backup

Users should be able to back up their wallet and restore it on another device or after reinstall.

1. **Back up both locations:**
   - **DATA_DIR** — full folder (includes `zippymesh.db`, `db.json`, and any OAuth/wallet-related files).
   - **~/.zippy** — full folder (contains `wallet.json`).
2. **In-app backup (recommended):** The app should expose a **Back up wallet** (or **Export wallet**) flow in the dashboard that:
   - Produces a single backup file (e.g. encrypted export or a signed bundle) that includes what’s needed to restore the ZippyCoin wallet and, if desired, app wallet records.
   - Does **not** require users to browse the file system.
3. **Restore:** Document or implement **Restore from backup** so that:
   - Restore writes only into DATA_DIR and ~/.zippy (or configured paths);
   - Installer/updater never overwrites existing wallet or DATA_DIR content (see below).

Document in the dashboard and in INSTALLER_MATRIX / STANDALONE_README: “Back up your wallet via Dashboard → Wallet → Back up; keep the file safe. Also back up DATA_DIR and ~/.zippy if you do manual backups.”

---

## Installer and updater rules (never overwrite wallet)

Any **installer** or **updater** (NSIS, .dmg, .deb, zip upgrade script, etc.) **must**:

1. **Detect existing install** — Before installing or upgrading, check for existing user data:
   - Does DATA_DIR (platform default or configured) already exist and contain `zippymesh.db` or `db.json`?
   - Does `~/.zippy/wallet.json` (or equivalent) exist?
2. **Never overwrite user data:**
   - **Do not** replace, delete, or overwrite the contents of **DATA_DIR**.
   - **Do not** replace, delete, or overwrite **~/.zippy** (or the configured ZippyCoin wallet path).
3. **Install/upgrade only app binaries and assets:**
   - Replace or add: app executable, `.next` (standalone) bundle, `public/`, node runtime if bundled.
   - Do **not** touch DATA_DIR or ~/.zippy (except to create empty dirs on **first install only** if missing).
4. **First install vs upgrade:**
   - **First install:** Create DATA_DIR and ~/.zippy if they do not exist; do not copy in default wallet files that would overwrite user data.
   - **Upgrade:** Treat existing DATA_DIR and ~/.zippy as sacred; only add new files if the app expects them (e.g. migration outputs), and never overwrite existing DB or wallet files without a versioned migration (see below).

These rules apply to: GUI installers (Windows/macOS/Linux), zip-based upgrade scripts (e.g. `upgrade.ps1`), and any CI or script that deploys a new build.

---

## Migrations (wallet and consensus improvements)

When we improve the ZippyCoin wallet format, signing logic, or consensus-related behavior:

1. **Versioned format** — Wallet and DB schema/format should carry a version (e.g. in `wallet.json` and in SQLite or db.json). App startup checks version and runs migrations if needed.
2. **Migrations are additive and non-destructive where possible:**
   - Prefer: add columns, add tables, write new files, then deprecate old paths.
   - Avoid: deleting or overwriting existing wallet or DB files unless a migration explicitly backs them up first and then applies a one-way upgrade.
3. **Migration steps:**
   - On startup, if stored version &lt; current supported version, run a **migration script** that:
     - Optionally backs up the current DATA_DIR and ~/.zippy (or at least wallet.json and zippymesh.db) to a timestamped folder.
     - Applies schema/format changes (e.g. ALTER TABLE, new wallet.json fields).
     - Updates the stored version so we don’t re-run the same migration.
   - Document each migration in release notes and, if useful, in a `docs/MIGRATIONS.md` or CHANGELOG.
4. **Rollback:** If a migration fails or is reverted in code, the app should detect the mismatch and either refuse to start with a clear message or run a backward-compatible path if we support it. Backup-before-migrate allows manual rollback by restoring the timestamped backup.

This keeps existing wallets safe across ZippyCoin wallet and consensus refinements.

---

## Checklist for release and installer authors

- [ ] Installer/updater never writes into DATA_DIR or ~/.zippy except: create empty dirs on first install, or add new files that do not overwrite existing wallet/DB.
- [ ] Upgrade path (zip or GUI) replaces only app files; user data (DATA_DIR, ~/.zippy) is left intact.
- [ ] Docs and in-app copy tell users how to back up their wallet (in-app export and/or manual backup of DATA_DIR + ~/.zippy).
- [ ] Any change to wallet format or consensus runs a versioned migration and, where appropriate, backs up before migrating.
