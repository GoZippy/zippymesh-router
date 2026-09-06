# ZippyMesh LLM Router — Prebuilt Install

This folder is a **standalone build**. No `npm install`, no build step.
Everything you need is right here.

---

## Requirements

- **Node.js 20.9 or newer** (20.x / 22.x / 24.x / 25.x). [Download](https://nodejs.org/).
  Node 18 does **not** work.

> This bundle contains a compiled native module for the OS it was built on. A
> Windows bundle will not run on Linux or macOS, and vice versa.

---

## Install and run

### 1. Unzip

Extract this archive to a folder (e.g. `C:\ZippyMesh` or `~/zippymesh-router`).
`server.js` sits at the top level of that folder.

### 2. Configure — pick one

**Option A — no `.env` (recommended).** One-time, from this folder:

```bash
node store-bootstrap.cjs
```

It asks only for a **port** (default 20128) and generates a `JWT_SECRET`,
storing both in `bootstrap.secret` (mode 0600) in your app data directory —
`%APPDATA%\zippy-mesh` on Windows, `~/.zippy-mesh` on macOS and Linux. No
`.env` is created. You set your **password in the browser** at first run.

**Option B — `.env` file.** Copy `.env.example` to `.env` and set `JWT_SECRET`
(generate one with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
`PORT` and `DATA_DIR` are optional. Do not put a password in `.env`.

### 3. Start

**Windows:**
```cmd
start-stable.cmd
```

**macOS / Linux:**
```bash
chmod +x start-stable.sh
./start-stable.sh
```

Or directly: `node run.js` (Option A) / `node server.js` (Option B).

### 4. Open the dashboard

**http://localhost:20128** — the setup wizard at `/setup` walks you through
creating your dashboard password. It is stored as a bcrypt hash in your data
directory, never in a file here.

---

## Port and network access

- Default: **http://127.0.0.1:20128** — loopback only. Nothing on your network
  can reach it.
- **Port:** `PORT` in `.env`, or the port you chose in `store-bootstrap.cjs`.
  A real environment variable overrides both.
- **Network access:** run `start-stable.cmd --lan` / `./start-stable.sh --lan`,
  or set `ZIPPY_BIND_HOST=0.0.0.0`, and open port 20128 in your firewall. Other
  devices then use `http://<this-PC-IP>:20128`.

  **Enable login first.** With login disabled, anyone who can reach the port is
  treated as an administrator. The server warns on stderr whenever it binds a
  non-loopback address.

---

## Using it

Point any OpenAI-compatible client at `http://localhost:20128/v1`.

Model ids are **provider-prefixed** — list them first and copy the id verbatim:

```bash
curl -s http://localhost:20128/v1/models

curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"ollama/qwen3.5:4b","messages":[{"role":"user","content":"Hello"}]}'
```

---

## Data and upgrades

- **Data** lives outside this folder: `%APPDATA%\zippy-mesh` (Windows) or
  `~/.zippy-mesh` (macOS/Linux), or wherever `DATA_DIR` points. It holds
  `db.json` (your password hash, vault entries, provider credentials) and
  `zippymesh.db`. **Back it up.**
- **Upgrading:** stop the server, replace the files in this folder with a new
  release. Do not touch your data directory or `~/.zippy`. Keep your `.env` if
  you use one.
- **Wallet backup:** Dashboard → Wallet → Backup. Keep the file secret.

---

## Troubleshooting

**It started on port 3000** — this bundle's entry point was not patched at
build time. Re-run `node scripts/prepare-standalone.cjs --patch-server .` from
a source tree, or get a newer release.

**`invalid ELF header` / `Could not locate the bindings file`** — this bundle
was built for a different OS. Download the one for your platform.

**Setup wizard keeps reappearing** — no password hash is stored yet; finish
`/setup` in the browser.

---

## Help and support

- **Support:** [zippymesh.com](https://zippymesh.com) or **Support@GoZippy.com**
- **Version:** dashboard header, or `GET http://localhost:20128/api/health`
