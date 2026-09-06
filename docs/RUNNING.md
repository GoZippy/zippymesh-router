# Running ZippyMesh Router

How to run the app from a **source tree** — in development, as a production
standalone build, or as an always-on instance for agents.

Installing from a **release zip** instead? See [SETUP.md](./SETUP.md).

---

## Development vs standalone

| Mode | Command | Binds | Use |
|------|---------|-------|-----|
| **Dev** | `npm run dev` | `127.0.0.1:20128` | Iterate on code |
| **Dev (LAN)** | `npm run dev:lan` | `0.0.0.0:20128` | Reach the dev server from another machine |
| **Standalone** | `start-stable.cmd` / `./start-stable.sh` | `127.0.0.1:20128` | Production, stable instance |
| **Standalone (LAN)** | `start-stable.cmd --lan` | `0.0.0.0:20128` | Production, reachable on the LAN |
| **`next start`** | `npm start` / `npm run start:lan` | `127.0.0.1` / `0.0.0.0`, port 20128 | Runs the non-standalone server |

`npm run dev` binds **loopback only**. Use the explicit `:lan` variants to
expose either server; both refuse to surprise you.

> **Do not use `next dev` to verify behaviour.** It recompiles route modules on
> demand, which re-evaluates module state — the in-memory vault master password
> is dropped, so the first read after an unlock reports "locked". Verify against
> a production build.

---

## Production build flow

- **`npm run build:next`** — Next.js build with `output: 'standalone'`; produces `.next/standalone/`.
- **`npm run prepare-standalone`** — copies `.next/static` and `public/` into the bundle, adds `README.md`, `.env.example`, `run.js`, `store-bootstrap.cjs`, `bootstrapEnv.cjs`, the sidecar binary, and the `start-stable` launch scripts — and **patches the generated `server.js`** (see below).
- **`npm run build:standalone`** — both of the above.
- **`npm run build`** — same, via `scripts/build.cjs`: a hardcoded-secret scan, then the Next build with a Windows retry (a transient `better_sqlite3` unlink `EPERM` retries into an isolated `.next-win-retry-*` output dir).

### Why `prepare-standalone` patches `server.js`

Next generates the standalone entry point on every build, and its template ends
up with:

```js
const currentPort = parseInt(process.env.PORT, 10) || 3000
const hostname = process.env.HOSTNAME || '0.0.0.0'
```

Both lines run **before** Next loads `.env`, and both defaults are wrong for
this product: port 3000 rather than 20128, and a bind on every interface rather
than loopback. `prepare-standalone.cjs` prepends a preamble that resolves them
first, so the shipped bundle:

- reads `.env` from the bundle directory (or from `ZIPPY_ENV_FILE`);
- listens on `PORT`, else `ZIPPY_PORT`, else **20128**;
- binds `ZIPPY_BIND_HOST`, else `HOST`, else `HOSTNAME`, else **127.0.0.1**, matching `src/lib/net/bindHost.js`;
- warns on stderr whenever it binds a non-loopback address.

Real environment variables always win over `.env`. The build **fails** if the
patch cannot be applied, rather than shipping a bundle that listens on
`0.0.0.0:3000`.

Repair an already-unpacked install without rebuilding:

```bash
node scripts/prepare-standalone.cjs --patch-server /path/to/install
```

### Where `.env` is read from

The generated `server.js` calls `process.chdir(__dirname)`, so it and Next both
resolve `.env` relative to **`.next/standalone/`**, not the project root.
`start-stable.cmd` / `start-stable.sh` set `ZIPPY_ENV_FILE` to the root `.env`
so the file you edit is the file that takes effect. If you launch
`node .next/standalone/server.js` yourself, either set `ZIPPY_ENV_FILE` or put
the `.env` inside the bundle.

> `next build` also leaves a copy of your `.env` inside `.next/standalone/`.
> Never hand-zip that folder — use `npm run package-release`, which excludes
> `.env`, `data` and `bootstrap.secret` and then re-inspects the archive and
> refuses to publish one containing secret material.

---

## First install from source

1. Clone the repo.
2. `npm install`
3. `npm run setup` — generates `JWT_SECRET` and `SIDE_CAR_SECRET` into
   `<DATA_DIR>/router-config.json` and syncs them into `.env` (created from
   `.env.example` if absent). It is idempotent: a second run rewrites nothing.
4. `npm run build`
5. `start-stable.cmd` (Windows) or `./start-stable.sh` (macOS/Linux).

`setup-env.mjs` also runs automatically as `predev` / `prebuild`. To keep a
verification run from touching `.env` at all:

```bash
node scripts/setup-env.mjs --no-env       # or ZIPPY_SETUP_NO_ENV_WRITE=1
DATA_DIR=/tmp/throwaway node scripts/setup-env.mjs --no-env
```

It honours `DATA_DIR`, never rewrites a file whose content would be unchanged,
and never replaces a password you set with the built-in default.

---

## Stable instance for agents and bots

Run one always-on instance so agents, Cursor and bots get a fixed base URL.

### Dedicated install directory

Use a separate directory (e.g. `C:\ZippyMesh`) holding the unpacked release —
no repo clone needed. **Stable install = unpack release + configure + run.**
See [SETUP.md](./SETUP.md).

### Network access (other machines on the LAN)

1. Start with `--lan`, or set `ZIPPY_BIND_HOST=0.0.0.0`.
2. Open firewall port 20128.
3. Base URL: `http://<this-PC-IP>:20128` — e.g.
   `ZIPPYMESH_ROUTER_URL=http://192.168.1.100:20128`.

**Enable login first.** With `requireLogin` false, any host that can reach the
port is treated as superadmin.

**Validation:** `npm run test:connectors` checks health, models, provider
status and chat.

### Health and version

- **GET `/api/health`** → `{ ok, status, service, version, uptime, providersConfigured, providersActive, providersRateLimited, timestamp, apiVersion, endpoints }`.
- Agents and upgrade scripts can poll `version` to confirm which build is live.

---

## Running as a service

See [SETUP.md](./SETUP.md#running-as-a-service) for NSSM, systemd and PM2 unit
definitions. Point the working directory at the folder containing `server.js`,
and set `DATA_DIR` explicitly for a service account.

---

## Data persistence

| Platform | Default `DATA_DIR` |
|----------|--------------------|
| Windows | `%APPDATA%\zippy-mesh` |
| macOS | `~/.zippy-mesh` |
| Linux | `~/.zippy-mesh` |

macOS uses `~/.zippy-mesh`, **not** `~/Library/Application Support` — the
resolver is `getUserDataDir()` in `src/lib/localDb.js`. `DATA_DIR` overrides it
everywhere; prefer an absolute path.

### Database files

| File | Contents |
|------|----------|
| `db.json` | Settings, `firstRun` flag, bcrypt password hash, node identity, vault entries, provider credentials |
| `zippymesh.db` (+ `-wal`, `-shm`) | SQLite: providers, models, wallets, routing, usage |
| `bootstrap.secret` | `JWT_SECRET` + port, when created by `store-bootstrap.cjs` (mode 0600) |
| `router-config.json` | `JWT_SECRET`, `SIDE_CAR_SECRET`, `INITIAL_PASSWORD`, written by `npm run setup` |
| `guardrails.config.json` | Guardrail rules (optional) |

The ZippyCoin mesh wallet lives in **`~/.zippy/wallet.json`**, separate from
`DATA_DIR`. **Back up both.** Installers and updaters must never overwrite
them — see [WALLET_BACKUP_AND_INSTALLER_SAFETY.md](./WALLET_BACKUP_AND_INSTALLER_SAFETY.md).

### The standalone `data` link

`prepare-standalone.cjs` can link `.next/standalone/data` at the per-user data
directory. **It no longer does so by default.** The link bound a build artifact
to the live secret store and made `zip -r` (which follows symlinks) capable of
packaging `db.json` into a release archive, and nothing in the app needs it:
`localDb.js` resolves the data directory itself. Set
`ZIPPY_STANDALONE_DATA_LINK=1` if you want the old behaviour — the only case it
serves is the discouraged `DATA_DIR=./data` layout.

---

## Upgrading an existing install

1. Stop the server.
2. Back up `DATA_DIR`, `~/.zippy`, and `.env`.
3. Replace the app files. Do **not** overwrite `.env`, `DATA_DIR`, or `~/.zippy`.
4. Re-run `npm run prepare-standalone` if you rebuilt from source.
5. Restart and check `GET /api/health` reports the new `version`.

---

## Port conflict

- **Stable instance:** port 20128.
- **Dev alongside it:** `npm run dev -- -p 20129`.

If the server comes up on **port 3000**, the bundle's entry point is unpatched —
run `node scripts/prepare-standalone.cjs --patch-server <install-dir>`.
