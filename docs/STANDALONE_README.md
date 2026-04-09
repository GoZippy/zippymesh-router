# ZippyMesh LLM Router — Prebuilt Install

This folder is a **standalone build**. No `npm install` or build step required.  
**No .env required** — use the one-time setup below; secrets are stored in your user profile.

---

## Requirements

- **Node.js 20+** (LTS recommended). [Download](https://nodejs.org/) if needed.

---

## Install and run (no .env)

### 1. Unzip

Extract this archive to a folder (e.g. `C:\ZippyMesh` or `~/zippymesh-router`).

### 2. First-time setup (one-time)

From this folder, run:

```bash
node store-bootstrap.cjs
```

You will be prompted for a **dashboard password** (and optional port; default 20128). Secrets are stored in your app data directory (e.g. `%APPDATA%\zippy-mesh` on Windows, `~/.zippy-mesh` on Linux). No `.env` file is created.

### 3. Start the server

```bash
node run.js
```

### 4. Open the dashboard

**http://localhost:20128/dashboard** — log in with the password you set in step 2.

---

## Optional: use .env instead

If you prefer a `.env` file (e.g. for scripts or CI), copy `.env.example` to `.env`, set `JWT_SECRET` and `INITIAL_PASSWORD`, then run **`node server.js`** instead of `node run.js`. The app uses `.env` when present; otherwise it uses the stored bootstrap from `store-bootstrap.cjs`.

---

## Port and network access

- Default port: **20128**. Set during `store-bootstrap.cjs` or via `PORT` in `.env`.
- For LAN access: set `HOSTNAME=0.0.0.0` and open port 20128 in the firewall. Other devices use `http://<this-PC-IP>:20128`.

---

## Data and upgrades

- **Data** is stored in a platform-specific folder (e.g. `%APPDATA%\zippy-mesh`, `~/.zippy-mesh`). The `data` link in this folder points there.
- **Upgrading:** Stop the server, replace app files with a new zip. Do **not** overwrite the data folder or `~/.zippy`. Your stored bootstrap (password) is in the data folder and is preserved.
- **Wallet backup:** Dashboard → Wallet → Backup; keep the file secret. See project docs on wallet backup and installer safety.

---

## Help and support

- **Support:** [zippymesh.com](https://zippymesh.com) or **Support@GoZippy.com**
- **Version:** Dashboard header or `GET http://localhost:20128/api/health`
