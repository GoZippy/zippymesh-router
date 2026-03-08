# Release Guide — ZippyMesh LLM Router

Maintainer checklist for cutting a release. See [DISTRIBUTION_PLAN.md](DISTRIBUTION_PLAN.md) for code classification and build pipeline.

---

## Pre-release checklist

- [ ] All tests pass: `npm run test && npm run test:providers`
- [ ] No hardcoded secrets; `.env.example` documents all required vars
- [ ] CHANGELOG.md updated with version and date
- [ ] `package.json` version bumped

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
2. **Backup** `DATA_DIR` (or `%APPDATA%\zippy-mesh` on Windows) and `.env`.
3. **Replace** app files: unpack the new release over the install dir, **excluding** `.env` and the data directory.
4. **Restart** the server from the install dir (run from project root if using dev layout, or use `node server.js` from the standalone folder with `DATA_DIR` and `PORT` set).

Use `upgrade.ps1` (Windows): `.\upgrade.ps1 [-ReleasePath <path-to-zip>] [-SkipBackup]`. See [RUNNING.md](RUNNING.md).

---

## Public release checklist (zippymesh-router)

Before making zippymesh-router public or pushing a release:

- [ ] Run `npm run validate-open-core -- --allow-stubs` — must pass
- [ ] Grep for secrets: no `.env`, `API_KEY`, `SECRET`, `password`, tokens, or absolute paths to your machine
- [ ] Confirm no `data/`, `*.db`, `.voidspec/`, `.vscode/` in tree or history
- [ ] History: use a clean branch (no commits that ever added .voidspec or .vscode), or run `git filter-repo` / `git filter-branch` to remove them
- [ ] See [REPO_ROLES.md](REPO_ROLES.md) and [OPEN_CORE_MANIFEST.md](OPEN_CORE_MANIFEST.md)
