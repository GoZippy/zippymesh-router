# ZippyMesh LLM Router — Installer and platform matrix

Target artifacts and one clean install path per platform. **Consumer installs**
should use **installers with onboarding** that store secrets in OS-native
secure storage (no `.env` on disk). See
[INSTALLER_AND_SECURE_STORAGE.md](./INSTALLER_AND_SECURE_STORAGE.md).

---

## Verified status

Legend: ✅ verified end-to-end on the date shown · 🟡 partially verified · 📋 target, not built · ❔ untested

| Platform | Artifact | Status | Last verified |
|----------|----------|--------|---------------|
| **Windows x64** | Zip + `start-stable.cmd` | ✅ install → first run → login → Ollama provider → `/v1/models` → real completion | 2026-08-30, Node 24.13.0, Win 10 |
| **Windows** | NSIS / Tauri installer | 📋 Target — no artifact built | — |
| **Linux x64** | Build from source → standalone | ✅ `npm ci` → `npm run build` → start → health → first run → login | 2026-08-30, Node 24.13.0, WSL2 Ubuntu 26.04 |
| **Linux x64** | Zip + `start-stable.sh` | 🟡 The bundle and launcher are produced and start correctly; **no Linux release zip is published yet** | 2026-08-30 |
| **Linux** | AppImage / .deb + first-run wizard | 📋 Target | — |
| **macOS** (Intel / Apple Silicon) | Zip + `start-stable.sh` | ❔ **Untested — no macOS machine available.** Nothing on this page about macOS has been executed | — |
| **macOS** | .dmg + first-run wizard | 📋 Target | — |
| **Raspberry Pi OS / arm64** | zip / package | ❔ Untested | — |
| **npm** | Wrapper package + bootstrap | 📋 Optional | — |

Full transcript and the deviations found:
[`_internal/INSTALL_AUDIT_2026-08-30.md`](./_internal/INSTALL_AUDIT_2026-08-30.md).

> **The release zip is platform-specific.** It bundles a compiled
> `better-sqlite3` native module. A zip built on Windows will not start on
> Linux or macOS. Every platform needs its own build.

---

## One clean install path per platform

**Requirements, all platforms:** Node.js **20.9+** (Next 16 requires
`>=20.9.0`; `better-sqlite3` supports the 20.x / 22.x / 24.x / 25.x lines).
Node 18 does not work.

### Windows (verified)

1. Download `zippymesh-router-vX.Y.Z-<platform>-<arch>.zip` for your OS (e.g. `-win32-x64`, `-linux-x64`).
2. Extract to a folder (e.g. `C:\ZippyMesh`). The archive's contents land at
   the root — there is no `.next\standalone` inside it.
3. Configure: either `node store-bootstrap.cjs` (no `.env`), **or** copy
   `.env.example` to `.env` and set `JWT_SECRET`.
4. Run `start-stable.cmd` (add `--lan` for network access).
5. Open `http://localhost:20128` and complete the setup wizard.

### Linux (build from source — verified; zip path not yet published)

1. `npm ci` then `npm run build` in a source tree, or unpack a Linux zip.
2. Configure as above (`node store-bootstrap.cjs`, or `.env`).
3. `chmod +x start-stable.sh && ./start-stable.sh`
4. Open `http://localhost:20128`.

### macOS (untested)

Expected to follow the Linux steps; **nobody has run it.** Data lives in
`~/.zippy-mesh` (not `~/Library/Application Support`).

### Raspberry Pi OS (target)

arm64 Node 20.9+, then the Linux steps. `better-sqlite3` must have an arm64
prebuild or a working build toolchain.

---

## Environment and ports

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `20128` | HTTP listen port. Falls back to `ZIPPY_PORT`. |
| `ZIPPY_PORT` | `20128` | The name `.env.example` and the Dockerfile use. |
| `ZIPPY_BIND_HOST` | `127.0.0.1` | Bind address. `0.0.0.0` for LAN; `HOST`/`HOSTNAME` are fallbacks. |
| `DATA_DIR` | Platform-specific | See [RUNNING.md](./RUNNING.md). |
| `JWT_SECRET` | (generated) | Session signing key. |
| `API_KEY_SECRET` | (ephemeral) | HMAC key for `/v1/*` router API keys — set it or keys break on restart. |

**Loopback by default.** The server binds `127.0.0.1` unless you opt in, and
warns on stderr whenever it binds anything else.

---

## Verification

After install, on any platform:

```bash
curl -s http://localhost:20128/api/health
# {"ok":true,"status":"ok","service":"zippymesh","version":"1.3.0",...}
```

Then `npm run test:connectors` (source tree) for health, models, provider
status and chat.

---

## Gap to "installs in one step"

Today's shortest path is still: install Node → download a zip → unpack →
configure → run a script. What each platform needs to reach a single command:

| Platform | One-command target | Missing |
|---|---|---|
| Windows | `winget install ZippyTechnologies.ZippyMeshRouter` | A signed MSI/NSIS package; a bundled Node runtime (or a documented dependency); a winget manifest in `microsoft/winget-pkgs`; code-signing certificate |
| macOS | `brew install --cask zippymesh-router` | A notarised `.dmg`/`.pkg` (Apple Developer ID + notarisation); a Homebrew cask; **a macOS build machine — none exists today** |
| Linux | `curl -fsSL https://zippymesh.com/install.sh \| sh` | A hosted install script; per-arch tarballs (x64 + arm64) with matching `better-sqlite3`; a systemd unit template; checksums and a signing key |
| Any | `npx @zippy/mesh-router` | Publishing to npm, and either shipping prebuilt native modules or requiring a build toolchain at install time |

Common to all four: a published, versioned release feed with checksums; an
unattended first-run that provisions `JWT_SECRET` and `API_KEY_SECRET` without
a prompt (`store-bootstrap.cjs` is interactive today); and an uninstall path
that leaves `DATA_DIR` and `~/.zippy` intact.

---

*Last updated: 2026-08-30.*
