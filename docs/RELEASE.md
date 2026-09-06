# Release Guide — ZippyMesh LLM Router

Maintainer checklist for cutting a release. See [DISTRIBUTION_PLAN.md](DISTRIBUTION_PLAN.md) for code classification and the build pipeline, and [PUBLIC_RELEASE_CHECKLIST.md](PUBLIC_RELEASE_CHECKLIST.md) for the separate gate that must pass before the public open-core repo is updated or made public.

---

## Release checklist (in order)

Each gate blocks the next — do not skip ahead if one fails. This is the full gate for 1.3.1 and every release after it. Versioning policy: patch (x.y.**Z**) for maturity/fix rounds; minor (x.**Y**.0) only for large functional changes that have been tested across releases; major for breaking changes.

1. **Clean tree on `dev-beta`.** `git status` shows nothing pending; every change intended for the release is committed. Uncommitted work does not ship.
2. **Unit tests green:** `npm run test:unit` exits 0.
3. **End-to-end tests green:** `npm run test:e2e` exits 0. This runs against a **production build** (`next build`, not `next dev` — a dev build recompiles route modules on demand and drops in-memory state like an unlocked vault) started against a throwaway `DATA_DIR`, never the operator's real data directory.
4. **Doctor green:** `node scripts/doctor.mjs` exits 0 against the built standalone app. Doctor checks env, the data directory, DB migrations, proxy-trust configuration, vault state, and provider reachability; a `warn` is acceptable, a `fail` is not.
5. **Community build validates:** `npm run build:community && node scripts/validate-open-core.cjs --allow-stubs --tree=community-dist` exits 0. This is the same gate the tag-triggered publish workflow runs — running it locally first avoids finding out about a stubbing problem after the tag is already pushed.
6. **CHANGELOG.md updated:** the `## Unreleased` section is retitled to `## vX.Y.Z (YYYY-MM-DD)` with every entry accurate to what actually shipped. Start a fresh empty `## Unreleased` above it for the next cycle.
7. **`package.json` version bumped** to match the CHANGELOG heading.
8. **Annotated tag pushed:** `git tag -a vX.Y.Z -m "Release vX.Y.Z"` then `git push origin vX.Y.Z`. Pushing a `v*` tag is what fires the release workflows — see below.
9. **Post-release verification:** a fresh install exactly per [SETUP.md](SETUP.md), on at least one platform, from the artifact the tag produced — not from the working tree. (Maintainers: cross-check this against the current install-audit notes before signing off; a full clean-machine audit is tracked separately per platform.)

Steps 2–5 are exactly what the Public Release Checklist re-runs against the open-core tree before that repo goes public — see [PUBLIC_RELEASE_CHECKLIST.md](PUBLIC_RELEASE_CHECKLIST.md) for the additional secret/path scan specific to publishing.

---

## What pushing a `v*` tag triggers

Two workflows key off a `v*` tag push today:

- **Community edition publish** — installs dependencies, runs `npm run test:unit`, builds the community tree, runs `validate-open-core --allow-stubs --tree=community-dist` as a hard gate, boots the built community tree and checks `/api/health`, then pushes that tree to the public repo and cuts a GitHub Release there. This already covers gate 2 and 5 above; it does **not** yet run the end-to-end suite or doctor (gates 3–4) — see the internal release plan for the proposed change that adds them.
- **Desktop installer build** — builds the production Next.js standalone bundle and the sidecar binary, then builds and uploads platform installers (Windows/macOS/Linux) to a draft release on this repo. It runs no test gate at all today.

Because neither workflow currently runs the end-to-end suite or doctor, gates 3 and 4 are a manual step before you tag until that CI change lands — do not rely on a green tag push alone to mean the release is sound.

---

## Build and publish (manual / local)

Useful when verifying a release candidate before tagging, or when building outside CI.

### 1. Production build

```bash
npm ci
npm run build:next
npm run prepare-standalone
```

Build output: `.next/standalone` (plus `.next/static`, `public`). Verify no errors, then run the end-to-end suite and doctor against it (gates 3–4 above).

### 2. Docker image (optional)

```bash
docker build -t zippymesh/router:X.Y.Z .
docker run -p 20128:20128 -e JWT_SECRET=test -e INITIAL_PASSWORD=test zippymesh/router:X.Y.Z
```

### 3. GitHub Release

The tag-triggered workflows above create releases automatically (a draft release with installers on this repo, a full release on the public repo). Fill in release notes from the CHANGELOG.md section for the version, and document any upgrade steps.

---

## Upgrading an existing install

1. **Stop** the running server (Ctrl+C or stop the service).
2. **Backup** `DATA_DIR` (or the OS per-user data directory — `%APPDATA%\zippy-mesh` on Windows, `~/.zippy-mesh` on macOS/Linux) and `.env` before replacing anything.
3. **Replace** app files: unpack the new release over the install dir, **excluding** `.env`, the data directory, and any wallet files. Never overwrite existing wallets or user data — see [WALLET_BACKUP_AND_INSTALLER_SAFETY.md](WALLET_BACKUP_AND_INSTALLER_SAFETY.md).
4. **Restart** the server from the install dir (run from project root if using a dev layout, or `node server.js` from the standalone folder with `DATA_DIR` and `PORT` set as needed).

Use `scripts/upgrade.ps1` (Windows). Its **only** parameter is `-Zip`, and it is
mandatory:

```powershell
.\scripts\upgrade.ps1 -Zip "C:\Downloads\zippymesh-router-v1.3.1-win32-x64.zip"
```

(This line used to document `-ReleasePath` and `-SkipBackup`; neither parameter
exists — `upgrade.ps1:5-8` declares one mandatory `[string]$Zip`. A separate
install-audit note claiming the script "does not exist" is also wrong; it is at
`scripts/upgrade.ps1` and `.gitignore` whitelists it explicitly. Corrected per
the 2026-08-30 adversarial review, item 16g.)

The script derives the version from the zip filename (`v…` at the end of the
stem), backs up the data directory, and refuses to run if the path does not
exist. It always backs up — there is no skip flag.

---

## Smoke test

Run with the standalone server up (e.g. `run-standalone.cmd` / `start-stable.cmd` from project root, or `node .next/standalone/server.js` with `PORT=20128`). This is a fast manual check, not a substitute for the end-to-end suite.

1. **Health:** `curl -s http://localhost:20128/api/health` → expect `{"ok":true,"version":"..."}`.
2. **Models (optional):** `curl -s http://localhost:20128/v1/models` → expect 200 and JSON with a `data` array.
3. **Dashboard:** open `http://localhost:20128/dashboard` in a browser → login and overview load.

If any step fails, do not ship the build; fix and rebuild.
