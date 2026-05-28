# Public Release Checklist — zippymesh-router

Before making the public repo (zippymesh-router) public or pushing a release:

## Validation (pre-publish gate)

- [ ] In zippymesh-router tree, run `npm run validate-open-core -- --allow-stubs` — **must pass** (exit 0). If it fails, proprietary paths are present; run `node scripts/stub-open-core.cjs` then validate again. Do not push or make repo public until this passes.
- [ ] Ensure `scripts/validate-open-core.cjs` and `scripts/stub-open-core.cjs` exist (see scripts allowlist in .gitignore)

## Secrets and paths

- [ ] Grep for secrets: no `.env`, `API_KEY`, `SECRET`, `password`, tokens, or absolute paths to your machine
- [ ] Confirm no `data/`, `*.db`, `.voidspec/`, `.vscode/` in tree or history

## History

- **Option A (recommended):** Create a **clean branch** for the public repo (e.g. from a fresh tree): no commits that ever added `.voidspec/`, `.vscode/`, or workstation-specific paths. Push that branch as `main` to zippymesh-router.
- **Option B:** If history already contains sensitive paths, run **git filter-repo** (or `git filter-branch`) in a clone of zippymesh-router to remove those paths from all commits; then force-push. Document the exact commands in REPO_ROLES or a private runbook so you can repeat for future releases.

## References

- [REPO_ROLES.md](REPO_ROLES.md) — what must not be public
- [OPEN_CORE_MANIFEST.md](OPEN_CORE_MANIFEST.md) — open-core manifest
