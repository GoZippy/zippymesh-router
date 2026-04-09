# Distribution Plan

## Release builds: project root and standalone

**Source of truth:** The project root (this repository) is the only place to edit source code and config. The contents of `.next/standalone/` (including `.next/standalone/.next/`, `server.js`, and `public/`) are **generated only** by the build and **must not be edited by hand**. Always run a full build from the project root before packaging a release.

### Before every release build

1. **Update root:** Bump `version` in `package.json`; update `README.md` and `.env.example` if needed; commit.
2. **Build from root:** From the project root run `npm run build` (or `npm run build:standalone`) so that `prepare-standalone` runs after the Next.js build and repopulates `.next/standalone/` from the current source.
3. **Smoke-test:** Run `node .next/standalone/server.js` (or `start-stable.cmd` / `start-stable.sh`) and confirm the dashboard, login, and help/support entry work.
4. **Package:** Create the distributable artifact from the **new** standalone output (e.g. zip the standalone folder or run the installer script). Do not reuse an old standalone copy.

### Optional: CI/release script

A script or CI job can (1) read `package.json` version, (2) run `npm run build` from root, (3) run a quick smoke test against the standalone server, (4) produce the distributable artifact. That keeps standalone and root in sync for every release.

---

## Publishing without giving away everything

How the **public build** and **repo** stay safe:

### What is public

- **Repo (if public):** Only committed, tracked files. `.gitignore` keeps out: `.env*`, `data/`, `.next/`, `node_modules`, `.cursor/`, most `scripts/`, `*.pem`, and other local/debug paths. So secrets and build artifacts never get committed.
- **Distributable (zip/installer):** The **standalone folder** only. That is: compiled Next.js (minified bundles in `.next/`), `server.js`, `public/`, traced `node_modules`, and the few allowed scripts (e.g. `prepare-standalone.cjs`). No raw source tree, no `.env`, no repo history.

### What never ships

- **Secrets:** Build is gated by `secrets-check.cjs` (and the same checks in `scripts/build.cjs`): hardcoded `clientSecret`, `sk-*`, `AIza*`, `GOCSPX-*` etc. in `src/` or `open-sse/` block the build. OAuth and API secrets live in the **user data directory** (e.g. `%APPDATA%/zippy-mesh`), provisioned via the dashboard, not in the app bundle.
- **Your .env:** `.env` is gitignored and is **not** copied by `prepare-standalone`. When packaging for release, do **not** add a `.env` from your machine into the zip. End users create their own via `npm run setup` (or copy `.env.example`); the packaged app can ship `.env.example` only (placeholders like `REPLACE_WITH_32_RANDOM_CHARS_MINIMUM`).
- **Full source:** If you distribute only the standalone artifact (e.g. from a private or minimal-public repo), users get a runnable app, not the full editable codebase.

### Recommended packaging

1. Build from root as above.
2. From the **standalone** directory, create the archive (zip/tarball) or run your installer. Exclude any `.env` that might exist under standalone (e.g. from local runs); include `.env.example` if you want users to have a template.
3. Publish the artifact (e.g. GitHub Releases, zippymesh.com/download) and optionally the repo. Repo can be public “open core” with everything sensitive gitignored, or private with only the binary public.

---

## GitHub repositories

Separate repos give you **open code** in one place and **versioned prebuilt installers** in another, without leaking full source or build pipeline.

| Repo | URL | Visibility | Purpose |
|------|-----|------------|---------|
| **ZippyMesh_LLM_Router** | [github.com/GoZippy/ZippyMesh_LLM_Router](https://github.com/GoZippy/ZippyMesh_LLM_Router) | Your choice | **Source of truth.** Develop here; cut release branches and tags. Same tree can be synced to zippymesh-dist for building. |
| **zippymesh-dist** | [github.com/GoZippy/zippymesh-dist](https://github.com/GoZippy/zippymesh-dist) | **Private** | **Release engineering.** Full source + build scripts + validation. Run `npm run build`, produce zip/Docker/installers. Publish **GitHub Releases** from here with versioned artifacts (e.g. `zippymesh-router-v1.0.0-win.zip`). |
| **zippymesh-router** | [github.com/GoZippy/zippymesh-router](https://github.com/GoZippy/zippymesh-router) | **Public** (after validation) | **Open-core.** UI, config, docs, Docker scaffolding only. Proprietary paths (routing engine, sidecar, translator, chatCore) must be stubbed or omitted. Run `npm run validate-open-core` before push. See [OPEN_CORE_MANIFEST.md](OPEN_CORE_MANIFEST.md). |
| **zippymesh-importer** | [github.com/GoZippy/zippymesh-importer](https://github.com/GoZippy/zippymesh-importer) | Your choice | **Utility.** Separate tool (e.g. import config/settings from another app or old install). Not part of the Router build; version and release independently if needed. |

**Flow:** Develop in ZippyMesh_LLM_Router → sync release candidate to zippymesh-dist → build and attach artifacts to a GitHub Release (version tag, changelog, checksums) → optionally sync open-core tree to zippymesh-router and push after validation.

### Release flow (concrete steps)

**From this repo (ZippyMesh_LLM_Router) when publishing via zippymesh-dist:**

1. **Tag and build**
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   npm run build
   npm run package-release
   ```
   `package-release` zips `.next/standalone/` (excluding `.env`) to `dist/zippymesh-router-v<version>.zip` and prints the next commands.

2. **Sync to zippymesh-dist** (manual or script)
   - Push the same tag/branch to zippymesh-dist, or copy the built `.next/standalone` and the zip into zippymesh-dist and commit the zip under a `releases/` or attach it via GitHub UI.
   - Example (if zippymesh-dist has this repo as a remote):  
     `git push dist main` then in zippymesh-dist run `npm run build` and `npm run package-release`.

3. **Create GitHub Release from zippymesh-dist**
   ```bash
   cd /path/to/zippymesh-dist
   gh release create v1.0.0 dist/zippymesh-router-v1.0.0.zip --notes "Release v1.0.0"
   ```
   Or create the release in the GitHub UI and upload the zip. Add SHA-256 checksum to the notes if desired.

4. **Optional: update zippymesh-router (open-core)**  
   After validation (`npm run validate-open-core -- --allow-stubs`), push the open-core tree to zippymesh-router and tag the same version there.

---

## Consumer installs: installer and secure storage

For **public distribution** we target **installer-based installs** with onboarding that stores secrets in OS-native secure storage (no `.env` on consumer machines). This keeps install simple and secure across Windows, macOS, Linux (and later iOS/Android if needed). The **zip remains** for advanced or from-source users. See [docs/INSTALLER_AND_SECURE_STORAGE.md](INSTALLER_AND_SECURE_STORAGE.md) for the design and [docs/INSTALLER_MATRIX.md](INSTALLER_MATRIX.md) for artifact status.
