# Public Release Checklist — zippymesh-router

This is the **publish gate** for the public open-core repo specifically: secrets, paths, and history. It assumes the general release checklist in [RELEASE.md](RELEASE.md) — tests, doctor, version bump, tag — has already passed; this list does not repeat those steps.

Before making the public repo (zippymesh-router) public or pushing a release:

## Validation (pre-publish gate)

- [ ] From the root repo, `npm run build:community && node scripts/validate-open-core.cjs --allow-stubs --tree=community-dist` — **must pass** (exit 0). This is the same command as gate 5 in [RELEASE.md](RELEASE.md); running it here re-validates the tree you are about to push to the public repo, not just the build output. If it fails, proprietary paths are present; run `node scripts/stub-open-core.cjs` (or fix the leak at the source) then validate again. Do not push or make the repo public until this passes.
- [ ] If validating an already-checked-out `zippymesh-router` tree directly (rather than a freshly built `community-dist`), the equivalent is `npm run validate-open-core -- --allow-stubs` run from inside that tree, with no `--tree` flag.
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
