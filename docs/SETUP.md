# ZippyMesh LLM Router — Standalone Setup Guide

Install and run ZMLR from a **prebuilt release zip**. No `npm install`, no build
step. To build from source instead, see [RUNNING.md](./RUNNING.md); to build the
Rust node binary, see [build-from-source.md](./build-from-source.md).

*Verified end-to-end on Windows 10 with Node 24.13.0 on 2026-08-30 — see
[`_internal/INSTALL_AUDIT_2026-08-30.md`](./_internal/INSTALL_AUDIT_2026-08-30.md)
for the transcript and the current platform coverage.*

## System requirements

- **Node.js 20.9 or newer.** Next 16 requires `>=20.9.0` and the bundled
  `better-sqlite3` supports the 20.x / 22.x / 24.x / 25.x lines. Node 18 does
  **not** work.
- **OS**: Windows, macOS, or Linux (x64/arm64 with a matching Node build).
- **RAM**: 512 MB minimum, 1 GB+ recommended.
- **Disk**: ~150 MB for the unpacked bundle, plus your data directory.

> The release zip contains a **compiled native module** (`better-sqlite3`) for
> the platform it was built on. A Windows zip will not run on Linux or macOS and
> vice versa — download the zip for your OS, or build from source. The filename
> says which: `zippymesh-router-v<version>-<platform>-<arch>.zip`, e.g.
> `zippymesh-router-v1.3.1-win32-x64.zip` or `…-linux-x64.zip`.

---

## Quick start

### 1. Download and extract

```bash
unzip zippymesh-router-v1.3.1-linux-x64.zip -d ~/zippymesh
cd ~/zippymesh
```

The archive's contents sit at the **root** of the folder you extract into:
`server.js`, `run.js`, `store-bootstrap.cjs`, `start-stable.cmd`,
`start-stable.sh`, `.env.example`, `node_modules/`, `.next/`, `public/`.
There is no `.next/standalone` subfolder inside a release — the release *is*
the standalone bundle.

### 2. Configure

Pick **one** of these. Both are supported; neither needs the other.

**Option A — no `.env` (recommended).** A one-time prompt stores a generated
`JWT_SECRET` and your port in `bootstrap.secret` inside your data directory,
with mode 0600:

```bash
node store-bootstrap.cjs     # asks for a port, defaults to 20128
```

Then start with `node run.js` (step 3).

**Option B — `.env` file.** For scripted, CI, and container installs:

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=<32+ random hex chars>

# Optional — the defaults below are what you get if you set nothing
PORT=20128
# ZIPPY_BIND_HOST=127.0.0.1
# DATA_DIR=/absolute/path/to/data
```

`.env.example` ships `ZIPPY_PORT=20128`; `PORT` and `ZIPPY_PORT` are both
accepted for the listening port (`PORT` wins). Do **not** put a password in
`.env` — you set it in the browser at first run (step 4).

### 3. Start the router

**Windows:**
```cmd
start-stable.cmd
```

**macOS / Linux:**
```bash
chmod +x start-stable.sh
./start-stable.sh
```

Or start Node directly, from the folder you extracted into:

```bash
node server.js       # uses .env  (Option B)
node run.js          # uses bootstrap.secret  (Option A)
```

Both listen on **http://127.0.0.1:20128** by default. Add `--lan` to either
launch script (or set `ZIPPY_BIND_HOST=0.0.0.0`) to expose the node to your
network — see [Network access](#network-access) first.

### 4. First run

Open **http://localhost:20128**. The setup wizard at `/setup` asks you to
create the dashboard password; it is stored as a bcrypt hash in your data
directory, never in `.env`.

Then:

1. **Add a provider.** Providers page → add your API keys. For a local Ollama /
   LM Studio / llama.cpp runtime, use **Discover local runtimes** — ZMLR probes
   the well-known ports and registers what it finds.
2. **Test connection** on each provider.
3. **Create a router API key** (Profile page) for external clients.

---

## Configuration reference

### Environment variables

Every variable below is read from the real process environment first, then from
`.env` in the bundle directory. Real environment variables always win.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `20128` | HTTP listen port. Falls back to `ZIPPY_PORT`, then 20128. |
| `ZIPPY_PORT` | `20128` | Same port, the name `.env.example`, the Dockerfile and P2P discovery use. `PORT` takes precedence. |
| `ZIPPY_BIND_HOST` | `127.0.0.1` | Bind address. Set `0.0.0.0` for network access. |
| `HOST` / `HOSTNAME` | (unset) | Fallbacks for the bind address, in that order, when `ZIPPY_BIND_HOST` is unset. `HOST` is the Docker convention. |
| `DATA_DIR` | Platform-specific | Where all user data and secrets live. Prefer an absolute path. |
| `JWT_SECRET` | (generated) | Session signing key. From `.env`, or generated into `bootstrap.secret` by `store-bootstrap.cjs`. |
| `API_KEY_SECRET` | (ephemeral) | HMAC key for router API keys served at `/v1/*`. **Without it, issued API keys stop working on every restart** and a warning is logged. Set it before you hand a key to any tool. |
| `SIDE_CAR_SECRET` | (none) | Shared bearer token between the server and the Rust mesh sidecar. Only needed if you run the sidecar. |
| `TRUST_PROXY` | (unset) | Set to `1` only behind a reverse proxy you control, so `X-Forwarded-For` is honoured for rate limiting. |
| `ZIPPY_NODE_BIN` | (none) | Absolute path to a ZippyCoin node binary. |

### Data directory

| Platform | Default |
|----------|---------|
| Windows | `%APPDATA%\zippy-mesh` |
| macOS | `~/.zippy-mesh` |
| Linux | `~/.zippy-mesh` |

macOS uses `~/.zippy-mesh`, **not** `~/Library/Application Support` — the
resolver is `getUserDataDir()` in `src/lib/localDb.js`.

Contents:

| File | Holds |
|------|-------|
| `db.json` | Settings, the bcrypt password hash, node identity, vault entries, provider credentials |
| `zippymesh.db` (+ `-wal`, `-shm`) | SQLite: providers, models, usage, routing |
| `log.txt` | Request log |
| `bootstrap.secret` | `JWT_SECRET` + port, when you used `store-bootstrap.cjs` |
| `router-config.json` | `JWT_SECRET`, `SIDE_CAR_SECRET`, `INITIAL_PASSWORD`, written by `npm run setup` in a source tree |

**Back this directory up.** It is the only copy of your password hash, vault
and provider credentials. Installers and updaters must never overwrite it — see
[WALLET_BACKUP_AND_INSTALLER_SAFETY.md](./WALLET_BACKUP_AND_INSTALLER_SAFETY.md).

---

## Using with AI tools

Point any OpenAI-compatible client at `http://localhost:20128/v1`.

**Model ids are provider-prefixed.** `/v1/models` returns ids like
`ollama/qwen3.5:4b`, `openai/gpt-4o-mini` — the bare upstream name
(`qwen3.5:4b`) is rejected with `No available accounts for …`. List the models
first and use the id verbatim:

```bash
curl -s http://localhost:20128/v1/models | grep -o '"id":"[^"]*"' | head

curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"ollama/qwen3.5:4b","messages":[{"role":"user","content":"Hello"}]}'
```

> **Known issue (2026-08-30):** `"model":"auto"` and the `zippymesh/*` /
> `local/*` routing playbooks return `404 model 'auto' not found` on a
> production build — the router picks a model (it comes back in the
> `x-selected-model` header) but forwards the literal `auto` upstream. Use an
> explicit prefixed model id until that is fixed.

**OpenAI SDK:**

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:20128/v1", api_key="your-router-api-key")
client.chat.completions.create(
    model="ollama/qwen3.5:4b",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

Add your router API key if `Require API key` is enabled in settings.

---

## Network access

By default ZMLR listens on **loopback only** — nothing on your network can
reach it. To change that:

1. Start with `start-stable.cmd --lan` / `./start-stable.sh --lan`, or set
   `ZIPPY_BIND_HOST=0.0.0.0`.
2. Open TCP port 20128 in your firewall.
3. Use the machine's IP: `http://<this-PC-IP>:20128`.

**Enable login before you do this.** With `requireLogin` off, any host that can
reach the port is treated as superadmin. The server prints a warning on stderr
whenever it binds a non-loopback address.

---

## Running as a service

### Windows (NSSM)

```cmd
nssm install ZippyMesh "C:\Program Files\nodejs\node.exe" "server.js"
nssm set ZippyMesh AppDirectory "C:\ZippyMesh"
nssm set ZippyMesh AppEnvironmentExtra "PORT=20128" "ZIPPY_BIND_HOST=127.0.0.1"
nssm start ZippyMesh
```

`AppDirectory` must be the folder holding `server.js` and `.env`.

### Linux (systemd)

`/etc/systemd/system/zippymesh.service`:

```ini
[Unit]
Description=ZippyMesh LLM Router
After=network.target

[Service]
Type=simple
User=zippymesh
WorkingDirectory=/opt/zippymesh
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=PORT=20128
Environment=ZIPPY_BIND_HOST=127.0.0.1
Environment=DATA_DIR=/var/lib/zippy-mesh

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now zippymesh
```

### PM2

```bash
cd /path/to/zippymesh
PORT=20128 pm2 start server.js --name zippymesh
pm2 save && pm2 startup
```

---

## Security checklist

1. **Enable login** (`Require login` in settings) and set a real password at
   `/setup`. Required before any non-loopback bind.
2. **Set `JWT_SECRET` and `API_KEY_SECRET`** to distinct 32+ char random values.
   Without `API_KEY_SECRET`, router API keys are invalidated on every restart.
3. **Enable `Require API key`** for `/v1/*` if anything but you can reach it.
4. **Firewall**: expose 20128 only to networks you trust.
5. **HTTPS**: terminate TLS at nginx or Caddy in front of ZMLR, and set
   `TRUST_PROXY=1` so rate limiting sees real client addresses.

---

## Upgrading

1. Stop the service.
2. Back up your data directory (and `~/.zippy` if you use the mesh wallet).
3. Extract the new zip over the install folder — but keep your `.env`.
4. Start again. Data persists; it lives outside the bundle.

---

## Troubleshooting

**Port already in use** — set `PORT` in `.env` (or the environment) and restart.

**It started on port 3000** — you are running an unpatched bundle. `server.js`
in a release is patched by `scripts/prepare-standalone.cjs` to default to
20128 and read `.env`. Repair an existing install with:
`node scripts/prepare-standalone.cjs --patch-server /path/to/install`.

**It is reachable from other machines and you did not ask for that** — check
for `ZIPPY_BIND_HOST`, `HOST` or `HOSTNAME` in your environment or `.env`;
the default is `127.0.0.1`.

**`Error: Could not locate the bindings file` / `invalid ELF header`** — the
`better-sqlite3` native module does not match this OS/Node version. Use the zip
for your platform, or build from source.

**Setup wizard keeps appearing** — `firstRun` is still `true` in
`<DATA_DIR>/db.json`, or no password hash is stored.

**Data not persisting** — confirm which directory is in use: the server writes
`db.json` and `zippymesh.db` under `DATA_DIR`, or the platform default above.

**Cannot connect to a provider** — Test on the Providers page, check the key,
and check the provider's status page.

---

## Support

- Documentation: [docs/](.) · API reference: [API.md](./API.md)
- Running and building: [RUNNING.md](./RUNNING.md)
- Website: [zippymesh.com](https://zippymesh.com) · **Support@GoZippy.com**
