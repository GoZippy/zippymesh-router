# Open-Core vs Full-Source Repo Split

Used to prepare the **public** repo (zippymesh-router) and validate that no proprietary code is exposed. Both repos start **private**; make zippymesh-router public only after validation.

---

## Repositories

| Repo | Visibility | Purpose |
|------|------------|---------|
| **zippymesh-router** | Private → Public after validation | Open-core: UI, config, docs, docker-compose. Transparent about what the app does and how it works. **Must not** contain the paths listed under "Proprietary" below. |
| **zippymesh-dist** | Private (permanent) | Full source, build pipeline, release artifacts. Used to build the sold product (Docker, zip, installers). |

---

## Proprietary (must NOT be in public repo)

These paths contain routing, translation, or sidecar logic that stays in the private repo or is stubbed in open-core:

| Path | Reason |
|------|--------|
| `src/lib/routing/engine.js` | Core routing and provider selection logic |
| `src/lib/sidecar.js` | Sidecar client and proxy integration |
| `open-sse/translator/` | All translator modules (format conversion) |
| `open-sse/handlers/chatCore.js` | Chat completion orchestration |

**Validation:** Run `node scripts/validate-open-core.cjs` from the repo root. It exits 0 only if none of these paths exist (or are stubbed). Use it before pushing to zippymesh-router or before making that repo public.

---

## Open (safe for public repo)

- Dashboard UI: `src/app/`, `src/shared/`
- Config and schemas: `.env.example`, config files
- Docs: `README.md`, `NOTICE.md`, `SECURITY.md`, `docs/` (except internal build notes)
- Docker: `Dockerfile`, `docker-compose.yml` (no secrets)
- API route **scaffolding** and auth wiring (login, settings, keys CRUD) — but the actual routing/translation must be stubbed or absent in open-core
- Sidecar: can be a **binary-only** reference (document how to build from separate repo) or omitted; no `sidecar/src/` in public if it contains proprietary logic

**Transparency:** The public repo should make it clear how the app is structured (dashboard, API surface, config), while the full routing and translation implementation lives in zippymesh-dist.

---

## Creating the repos (manual step)

Create both repos on GitHub as **private**:

1. **zippymesh-router**
   - Visibility: **Private** (switch to Public only after validation).
   - Description: `ZippyMesh LLM Router — open-core: UI, config, docs. Multi-provider AI routing.`
   - Do **not** push full source here. Push only the open-core tree (see "Preparing open-core tree" in [RELEASE.md](RELEASE.md)). Run `npm run validate-open-core` on that tree before pushing; it must exit 0.

2. **zippymesh-dist**
   - Visibility: **Private** (keep permanent).
   - Description: `ZippyMesh Router full source and release pipeline. Private.`
   - Push the full source from this project. Use this repo to run `npm run build`, Docker builds, and produce release artifacts.

---

## After validation

1. Run `node scripts/validate-open-core.cjs` on the tree you intend to push to zippymesh-router.
2. Confirm no secrets in repo (`.env` in .gitignore, no tokens in source).
3. Test that the **built** artifact from zippymesh-dist runs (Docker or `npm run start:prod`).
4. When satisfied, change zippymesh-router visibility to **Public**.
