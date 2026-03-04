# ZippyMesh Router — Which Repo Is What

## Summary

| Repo | Role | Visibility | Use |
|------|------|------------|-----|
| **zippymesh-router** | **Public release** (open-core) | **Public** when you flip the switch | What users and the public see. Open-core: UI, config, docs. Proprietary logic stubbed. No .voidspec, .vscode, or workstation data. |
| **zippymesh-dist** | **Private build / full source** | **Private forever** | Full source, build pipeline, release artifacts. Used to build the product you sell. Never make public. |

- **Public builds / open-core source** → **zippymesh-router** (https://github.com/GoZippy/zippymesh-router)
- **Private forever** → **zippymesh-dist** (https://github.com/GoZippy/zippymesh-dist)

## What must never be in the public repo

- `.voidspec/` — local tooling, journals, heartbeat logs
- `.vscode/` — IDE settings (can contain paths, preferences)
- `.env` or any file with secrets (only `.env.example` is safe)
- `data/`, `*.db` — runtime data
- Personal keys, API tokens, or machine-specific paths

## Pushing updates

- **To zippymesh-dist (private):** From your full source, `git push dist dev_alpha:main`. Use this repo to run `npm run build`, Docker, and produce release artifacts.
- **To zippymesh-router (public):** Push only the open-core branch after running `npm run validate-open-core -- --allow-stubs`. Prefer a clean branch (e.g. no history that ever contained .voidspec or .vscode).
