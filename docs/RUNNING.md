# Running ZippyMesh Router

How to run the app in development, standalone, or as a stable instance for agents.

---

## Development vs standalone

| Mode | Command | Port | Use |
|------|---------|------|-----|
| **Dev** | `npm run dev` | 20128 (or 20129 if stable uses 20128) | Iterate on code |
| **Standalone** | `run-standalone.cmd` or `node .next/standalone/server.js` | 20128 | Production, stable instance |

---

## Production build flow

- **`npm run build:next`** — Next.js build with `output: 'standalone'`; produces `.next/standalone/`.
- **`npm run prepare-standalone`** — Copies static/public into standalone and creates data-directory symlink.
- **`npm run build:standalone`** — Runs both (recommended for release).
- **`npm run build`** — Same as `build:standalone` (via `scripts/build.cjs`). On Windows, this script runs a secrets check, then Next.js build with retry: if a transient lock (e.g. `better_sqlite3` unlink EPERM) occurs, it retries using an alternate output dir (`.next-win-retry-*`) so the main `.next` dir is not locked.

**Build and .next lock (Windows):** If `npm run build` fails with a file-in-use or EPERM error, stop any running dev server (`npm run dev`) or other process using `.next` and run `npm run build` again. The build script retries up to 3 times with isolated output dirs when it detects the Windows better_sqlite3 unlink issue.

Always run the server from the **project root** (where `.env` lives), not from inside `.next/standalone`.

---

## First install

1. Clone or unpack the release.
2. `npm install`
3. `npm run setup` (creates `.env` from `.env.example` with generated secrets)
4. `npm run build:standalone` (or `npm run build:next` then `npm run prepare-standalone`)
5. Run from project root: `run-standalone.cmd` or `$env:PORT=20128; node .next/standalone/server.js`

---

## Stable instance for agents and bots

Run one always-on instance so AI agents, Cursor, and bots can use a fixed base URL.

### Dedicated install directory

Use a **separate directory** (e.g. `C:\ZippyMesh` or `K:\Deploy\ZippyMesh-Router`) containing:

- Built standalone (copy of `.next/standalone` + `.next/static` + `public`)
- `.env` (from project or `npm run setup`)
- Optional: dedicated `DATA_DIR` (e.g. `./data`)

No full repo clone needed for run-only. Document: **Stable install = unpack release + .env + run server.**

### Run from project root

**Always run from the directory that contains `.env`** so the app uses your data and login. If you run from inside `.next/standalone`, you get a fresh data dir and no .env.

**Windows:**
```cmd
run-standalone.cmd
```

Or use `start-stable.cmd` (sets PORT=20128, HOSTNAME=0.0.0.0 for network access). See project root.

### Network access (other PCs on LAN)

To allow agents on other machines (Claude Code, OpenClaw, etc.) to use the router:

1. **Use `start-stable.cmd`** (sets `HOSTNAME=0.0.0.0`) or set `HOSTNAME=0.0.0.0` when running.
2. **Dev mode**: `npm run dev` now binds to `0.0.0.0` by default (`-H 0.0.0.0`).
3. Open firewall port 20128.
4. Use base URL: `http://<this-PC-IP>:20128`

Example for agents: `ZIPPYMESH_ROUTER_URL=http://192.168.1.100:20128`

**Validation**: Run `npm run test:connectors` to verify health, models, provider status, and chat.

### Health and version

- **GET /api/health** — returns `{ ok, version, uptime, providersConfigured, ... }`
- Agents and upgrade scripts can check `version` to confirm the running instance.

---

## Running as a service (optional)

### Windows (NSSM)

1. Install [NSSM](https://nssm.cc/).
2. From the install dir (project root): `nssm install ZippyMesh "node" ".next\standalone\server.js"`
3. Set NSSM AppDirectory to the install dir; set env: `PORT=20128`, `HOSTNAME=0.0.0.0`, `DATA_DIR` if needed.
4. `nssm start ZippyMesh`

### PM2 (Windows/Linux/mac)

```bash
cd /path/to/install
PORT=20128 HOSTNAME=0.0.0.0 pm2 start .next/standalone/server.js --name zippymesh
pm2 save
pm2 startup  # enable on boot
```

---

## Data Persistence

ZippyMesh stores user data (settings, provider connections, playbooks, logs) in a platform-specific location:

| Platform | Default DATA_DIR |
|----------|------------------|
| Windows | `%APPDATA%\zippy-mesh` |
| macOS | `~/Library/Application Support/zippy-mesh` |
| Linux | `~/.zippy-mesh` |

### How it works

1. **`prepare-standalone.cjs`** creates a symlink from `.next/standalone/data` to the user data directory.
2. This ensures all data persists across rebuilds and restarts.
3. Override with `DATA_DIR` environment variable if needed.

### Database files

| File | Contents |
|------|----------|
| `db.json` | Settings, firstRun flag, node identity |
| `zippymesh.db` | SQLite: providers, models, wallets, routing |
| `guardrails.config.json` | Guardrail rules (optional) |

The ZippyCoin mesh wallet lives in **`~/.zippy/wallet.json`** (separate from DATA_DIR). **Backup:** Users should back up DATA_DIR and `~/.zippy`; installers and updaters must **never overwrite** these. See [WALLET_BACKUP_AND_INSTALLER_SAFETY.md](WALLET_BACKUP_AND_INSTALLER_SAFETY.md).

### Migration on rebuild

When you rebuild the standalone bundle:

1. Run `npm run prepare-standalone` — this creates/verifies the data symlink.
2. Existing user data is preserved automatically.
3. If standalone `data/` folder exists with real files (not symlink), they are migrated to the user directory.

### Troubleshooting

- **Setup wizard keeps appearing:** Check that `firstRun: false` in `db.json`
- **Providers missing:** Verify symlink exists: `dir .next\standalone\data` (should show `<JUNCTION>`)
- **Wrong data directory:** Set `DATA_DIR` in `.env` or environment

---

## Upgrading an existing install

1. Stop the server.
2. Backup `DATA_DIR`, `~/.zippy` (ZippyCoin wallet), and `.env`.
3. Replace app files (standalone bundle) — do **not** overwrite `.env`, DATA_DIR, or `~/.zippy`. Preserve existing wallets and user data. See [WALLET_BACKUP_AND_INSTALLER_SAFETY.md](WALLET_BACKUP_AND_INSTALLER_SAFETY.md).
4. Run `npm run prepare-standalone` to re-create symlinks.
5. Restart.

Use `upgrade.ps1` (Windows): run from install dir, `.\upgrade.ps1` to stop, backup, and restart. Use `-ReleasePath <path-to-new-standalone.zip>` to unpack a new release. Use `-SkipBackup` to skip backup.

---

## Port conflict

- **Stable instance:** use port 20128.
- **Dev:** use 20129 when stable is on 20128: `npm run dev -- -p 20129`
