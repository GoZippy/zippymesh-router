# Release Guide — ZippyMesh LLM Router

Maintainer checklist for cutting a release. See [DISTRIBUTION_PLAN.md](DISTRIBUTION_PLAN.md) for code classification and build pipeline.

---

## Pre-release checklist (MVP sale freeze)

- [ ] All tests pass: `npm run test && npm run test:providers`
- [ ] No hardcoded secrets; `.env.example` documents all required vars
- [ ] CHANGELOG.md updated with version and date
- [ ] `package.json` version bumped
- [ ] Smoke test: with standalone running, `GET /api/health` returns 200 and `ok: true`; optional: `GET /v1/models` returns 200 (see [MVP smoke test](#mvp-smoke-test) below)

---

## Build and publish

### 1. Tag and version

```bash
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

### 2. Production build

```bash
npm ci
npm run build:next
npm run prepare-standalone
```

Build output: `.next/standalone` (plus `.next/static`, `public`). Verify no errors.

### 3. Docker image (optional)

```bash
docker build -t zippymesh/router:1.0.0 .
docker run -p 20128:20128 -e JWT_SECRET=test -e INITIAL_PASSWORD=test zippymesh/router:1.0.0
```

### 4. GitHub Release

- Create a release from the tag
- Attach standalone zip (`.next/standalone` + static + public, or a packaged bundle)
- Document upgrade steps in release notes

---

## Upgrading an existing install

1. **Stop** the running server (Ctrl+C or stop the service).
2. **Backup** `DATA_DIR` (or `%APPDATA%\zippy-mesh` on Windows), `~/.zippy` (ZippyCoin wallet), and `.env`.
3. **Replace** app files: unpack the new release over the install dir, **excluding** `.env`, DATA_DIR, and `~/.zippy`. Never overwrite existing wallets or user data. See [WALLET_BACKUP_AND_INSTALLER_SAFETY.md](WALLET_BACKUP_AND_INSTALLER_SAFETY.md).
4. **Restart** the server from the install dir (run from project root if using dev layout, or use `node server.js` from the standalone folder with `DATA_DIR` and `PORT` set).

Use `upgrade.ps1` (Windows): `.\upgrade.ps1 [-ReleasePath <path-to-zip>] [-SkipBackup]`. See [RUNNING.md](RUNNING.md).

---

## MVP smoke test

Run with standalone server up (e.g. `run-standalone.cmd` or `start-stable.cmd` from project root, or `node .next/standalone/server.js` with PORT=20128).

1. **Health:** `curl -s http://localhost:20128/api/health` → expect `{"ok":true,"version":"..."}`.
2. **Models (optional):** `curl -s http://localhost:20128/v1/models` → expect 200 and JSON with `data` array.
3. **Dashboard:** Open `http://localhost:20128/dashboard` in browser → login and overview load.

If any step fails, do not ship the build; fix and rebuild.

---

## Public release checklist (zippymesh-router)

**Pre-publish gate:** Do not push to zippymesh-router or make the repo public until validation passes. Publish is blocked otherwise.

Before making zippymesh-router public or pushing a release:

- [ ] Run `npm run validate-open-core -- --allow-stubs` — **must pass** (exits 0); otherwise fix or stub proprietary paths per [OPEN_CORE_MANIFEST.md](OPEN_CORE_MANIFEST.md)
- [ ] Grep for secrets: no `.env`, `API_KEY`, `SECRET`, `password`, tokens, or absolute paths to your machine
- [ ] Confirm no `data/`, `*.db`, `.voidspec/`, `.vscode/` in tree or history
- [ ] History: use a clean branch (no commits that ever added .voidspec or .vscode), or run `git filter-repo` / `git filter-branch` to remove them
- [ ] See [REPO_ROLES.md](REPO_ROLES.md) and [OPEN_CORE_MANIFEST.md](OPEN_CORE_MANIFEST.md)
