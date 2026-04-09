# Run first public deployable build locally

Production build needs **~14–16 GB Node heap** (`--max-old-space-size=16384`). Ensure the machine has 16GB+ RAM and close other apps. For quick local testing without a full build, use `npm run dev` (dev server on port 20128).

See [docs/RUNNING.md](docs/RUNNING.md) for full reference: dev vs standalone, stable instance for agents, network access, upgrade, and optional service setup.

## 1. Build (one-time)

```bash
npm install
npm run build:next
npm run prepare-standalone
```

## 2. Run the app

**Always run from the project root** so the app loads your `.env` and uses your existing data (providers, login). If you run from inside `.next/standalone`, you get a fresh data dir and no .env, so you’ll appear logged out.

**Windows (CMD):**
```cmd
run-standalone.cmd
```

**Windows (PowerShell) from project root:**
```powershell
cd K:\Projects\ZippyMesh_LLM_Router
$env:PORT=20128; node .next/standalone/server.js
```

**Wrong (loses your data/login):** running `node server.js` from inside `.next/standalone` — no .env, different data.

## 3. Stable instance for agents and bots

Run one always-on instance so AI agents, Cursor, and bots use a fixed base URL. Use a **separate install dir** (e.g. `C:\ZippyMesh`) with only: built standalone, `.env`, and optional `DATA_DIR`. Use `start-stable.cmd` (project root) to set PORT=20128 and HOSTNAME=0.0.0.0 for network access. See [docs/RUNNING.md](docs/RUNNING.md).

## 4. Network access (other PCs on LAN)

Set `HOSTNAME=0.0.0.0`, open firewall port 20128. Base URL: `http://<this-PC-IP>:20128`.

## 5. Upgrading an existing install

Stop server → backup `DATA_DIR` and `.env` → replace app files (standalone) → restart. Use `upgrade.ps1` if provided. See [docs/RELEASE.md](docs/RELEASE.md).

## 6. Test

- Dashboard: http://localhost:20128/dashboard
- Login: http://localhost:20128/login
- API: http://localhost:20128/v1/chat/completions (with API key)
- Health: http://localhost:20128/api/health

Default password and JWT are from `.env` (copy from `.env.example` if needed). Sidecar is optional; set `SIDE_CAR_URL` if you run it separately.
