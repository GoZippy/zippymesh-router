# ZippyMesh LLM Router — Installer and platform matrix

Target artifacts and one clean install path per platform. Current baseline: distribution zip produced by `scripts/create-distribution.cjs`.

---

## Artifact targets

| Platform | Artifact | Status | Notes |
|----------|----------|--------|-------|
| **Windows** | Zip + `run-standalone.cmd` / `start-stable.cmd` | ✅ Baseline | Unpack → `.env` from `.env.example` → run script. Node.js required. |
| **Windows** | NSIS installer / portable exe | 📋 Planned | Post-MVP; optional bundled Node or launcher. |
| **Linux** | Zip + `start-stable.sh` | ✅ Baseline | Unpack → `.env` → `chmod +x start-stable.sh` → `./start-stable.sh`. |
| **Linux** | AppImage | 📋 Planned | Single-file; post-MVP. |
| **Linux** | .deb | 📋 Planned | Package manager; post-MVP. |
| **macOS** | Zip + `start-stable.sh` | ✅ Same as Linux | Use Linux flow. |
| **macOS** | .dmg | 📋 Planned | When Apple tooling available. |
| **Raspberry Pi OS** | arm64 zip + `start-stable.sh` | 📋 Planned | Same as Linux; build with Node arm64 or use generic zip + system Node. |
| **npm** | Wrapper package + bootstrap script | 📋 Optional | `npx`-style install; metadata only, fetches payload. |

---

## One clean install path per platform

### Windows (current)

1. Download `zippymesh-router-vX.Y.Z-YYYYMMDD.zip`.
2. Extract to a folder (e.g. `C:\ZippyMesh`).
3. Copy `.env.example` to `.env`; set `JWT_SECRET` and `INITIAL_PASSWORD` (or run `npm run setup` if npm is available in that tree).
4. From the extracted folder run `run-standalone.cmd` or `start-stable.cmd` (requires Node.js on PATH).
5. Open `http://localhost:20128`; complete setup wizard if first run.

**Requirements:** Node.js 18+ on PATH.

---

### Linux / macOS (current)

1. Download the distribution zip and extract (e.g. `~/zippymesh`).
2. `cp .env.example .env` and edit `.env` (or run `node scripts/setup-env.mjs` if scripts are present).
3. `chmod +x start-stable.sh` then `./start-stable.sh` (or `cd .next/standalone && PORT=20128 node server.js`).
4. Open `http://localhost:20128`.

**Requirements:** Node.js 18+.

---

### Raspberry Pi OS (target)

1. Use arm64 Node.js (official binary or package).
2. Same as Linux: zip extract → `.env` → `start-stable.sh`.
3. Ensure port 20128 is free and (optional) open in firewall.

---

## Environment and ports

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 20128 | HTTP server port. |
| `HOSTNAME` | 0.0.0.0 (start-stable) | Bind address; use 0.0.0.0 for LAN access. |
| `DATA_DIR` | Platform-specific | See [RUNNING.md](RUNNING.md). |

---

## Verification

- **Windows:** After install, `curl -s http://localhost:20128/api/health` returns `{"ok":true,"version":"..."}`.
- **Linux/macOS:** Same; or `wget -qO- http://localhost:20128/api/health`.

---

*Last updated: 2026-03-05.*
