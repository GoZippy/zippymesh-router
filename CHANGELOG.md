## Unreleased

*Post-v1.3.1 hardening from an adversarial review round: three adversarial reviewers tried to break the v1.3.1 changes (reports under `docs/_internal/ADVERSARIAL_REVIEW_*_2026-08-30.md`), and every finding below was reproduced before and after the fix against a production build. Two of the reviewers' "safe to ship? no — with fixes" blockers were Criticals in v1.3.1's own new code.*

### Security

- **An unauthenticated caller could register a fake "local" provider node and receive the operator's prompts** (`POST /api/provider-nodes`). Two root causes: the route had no route-level auth (only the edge gate, which is open in `requireLogin=false` mode), and `getProviderConnections({name})` silently ignored the `name` filter, so registering a second local node *overwrote the first node's connection record* and repointed the operator's live Ollama at the newcomer — a one-request runtime hijack. Fixed with four layers: `requireAuth` on every verb of the route; a host-class allow-list (`src/lib/routing/hostClass.js` — loopback/RFC1918/`.local` only; link-local and unresolvable names need an authenticated `allowRemote:true`; public addresses always refused, in ~5 ms with no probe, closing the SSRF + open/closed/filtered port oracle); per-node model namespacing (`ollama/<tag>` is owned loopback-first, every other node is `ollama@<host>-<port>/<tag>`); and route-time pinning of every model id to exactly one node. Registration failures now report a fixed class (`unreachable`/`timeout`/`unexpected_status`), never the upstream status, transport text, or response body, and the probed model list is capped and sanitised.
- **`zvault run` in a cloned repository exfiltrated the vault token and could reach RCE.** A repo-local `./.zvault.json` could set `url` and `tokenFile`, redirecting the token to an attacker host, and a `--map`/`--env`/reference could set `PATH` before the `.cmd`/`.bat` resolver ran, selecting a fake `claude.cmd`. Fixed: a CWD-discovered config can no longer set `url`/`tokenFile` (only `--config <path>` or `~/.zvault.json` may); `PATH`/`PATHEXT`/`NODE_OPTIONS`/`LD_*`/`DYLD_*` are rejected as reference/`--map`/`--env` targets; the command executable is resolved against the parent PATH captured before any injection. The vulnerable "commit a `.zvault.json`" recommendation was removed from `docs/ZVAULT_RUN.md`.
- **The release-zip leak scanner was inert on Windows** (`scripts/package-release.cjs`): the regex was double-escaped through a PowerShell single-quoted string, so five of six secret-filename guards (`.env`, `bootstrap.secret`, `db.json`, `oauth-secrets.json`, `router-config.json`) could never match — secrets could ship in a release. Replaced with an in-Node, ZIP64-aware central-directory scan (`scripts/lib/zipScan.cjs`) that fails the release on any hit. Verified against the real shipped `v1.3.0`/`v1.1.0` zips.
- **The prompt cache had no tenant dimension** — two unrelated bearer identities shared cache entries (cross-caller answer disclosure + a confirm-a-guess oracle). The key now includes a tenant component (`vk:<id>` | `key:<HMAC(JWT_SECRET, bearer)>` | `anon`); `x-cache: HIT` now means *this* identity ran *this* exact body before.
- **`ZMLR_URL`/`ZIPPYVAULT_URL` were unvalidated**, so one env var could POST the vault token to any host in cleartext. Both `zvault` and the MCP stdio vault proxy now require http(s) and refuse a non-loopback target unless `ZVAULT_ALLOW_REMOTE=1`/`ZMLR_ALLOW_REMOTE=1` *and* https.
- **`ZMLR_MCP_DEBUG` printed plaintext vault values to stderr** (which MCP hosts persist to disk). Debug logging now deep-redacts secret-shaped fields (`redactForDebug` in `src/mcp/zmlr-server.js`) and only enables on `=== "true"`.
- **`GET /api/v1/wallet`, its PATCH echo, and `GET /api/mesh/connections` returned `encryptedPrivateKey`** on unauthenticated routes. A `toSafeWallet()` projection replaces it with a `hasPrivateKey` boolean; `updateWallet` gained a column allow-list (`WALLET_UPDATABLE_FIELDS`), closing an unauthenticated SQL-identifier injection reachable from `PATCH /api/v1/wallet`.
- **`/api/cli-tools/*` removed from the edge public list and wrapped in `requireAuth`** — its POST fetched a caller-supplied URL with a caller-supplied bearer and persisted a caller-supplied API key. Fixed the missing `path` import that made `claude-settings` POST always 500, and de-obfuscated the `String.fromCharCode` homedir call that defeated the path scanner.
- **The unauthenticated first-run `PATCH /api/settings` bypass is narrowed to `{newPassword, currentPassword}`** — an anonymous caller can no longer flip `requireLogin:false` before setup completes.
- **`/api/health`'s 500 no longer returns the raw driver message** (which carried the data-dir path and OS username); it returns `message:"health check failed"` plus the driver `code`. The 200 payload is byte-identical.
- **Login lockout was a global DoS** — without `TRUST_PROXY` every caller shared one bucket, so five anonymous POSTs locked the operator out for 15 minutes, and the "successful login clears the streak" comment was false (the 429 returned before the clear). Replaced with a per-account progressive delay (250 ms doubling, 30 s cap, `src/lib/auth/loginBackoff.js`) plus a coarse 100-failure ceiling; the correct password always works and is never delayed. The rotating-`x-forwarded-for` bypass of the API-key rate limit (`getClientIp`) is closed at the chat route call site.
- **PR-time path scanning**: `secrets-check.cjs` now carries the internal-path patterns that previously ran only at tag time and scans the repo root; two baked absolute developer paths in `server.js` were replaced with `process.cwd()`.
- **No outbound request that carries a token or credential follows an HTTP redirect** (adversarial-verify residuals V-1/V-3): the local-runtime probe, the provider-node validate route, `zvault`'s token POST and the MCP stdio vault proxy use `redirect:"manual"`, so a validated loopback/RFC1918 URL cannot 302 the request onward to a public or cloud-metadata host and exfiltrate the API key or vault token. A probe 3xx is treated as `unexpected_status`.

### Fixed

- **`model:"auto"` returned empty content to conformant OpenAI clients** — an unconditional "+5 vision" score bonus picked a thinking model on text-only prompts and put the answer in the non-standard `message.reasoning`. Scoring no longer adds a vision bonus without an image part or picks a thinking model absent `X-Intent: reasoning`; empty `content` with truncated `reasoning` is folded into `content` with `x-zmlr-content-source: reasoning`. Measured 22.4 s / empty → 1.3 s / real content on a local box.
- **A prompt-cache HIT wrote no ledger row and never charged a virtual key** — a budgeted key could be replayed for free. HITs now write a `provider:"cache", status:"cache_hit"` row and charge the key. Streamed requests record their real `cost_usd` instead of `$0`.
- **`JWT_SECRET` self-provisions** into `<data dir>/bootstrap.secret` on first start, like `API_KEY_SECRET`; a fresh release zip previously answered 500 to every request until the interactive `store-bootstrap.cjs` was run. **`npm run dev`/`build` no longer overwrite an operator's `.env` `JWT_SECRET`/`SIDE_CAR_SECRET`** — a divergence is reconciled toward `.env` and reported (the old code silently rotated it while printing "Skipped").
- **Guardrail rules now ship in the standalone build.** `next build` bundles `src/utils/guardrails.js` but not `config/`, so a released build resolved 0 rules and `checkSafety()` was silently inert — content-policy prompts (violence terms, SSN patterns, PII redaction) passed through unfiltered. `scripts/prepare-standalone.cjs` now copies `config/guardrails.config.json` into the bundle and the loader resolves `<cwd>/config` (the standalone runs from the bundle root), so a fresh install loads all rules. An operator override in `DATA_DIR`/`%APPDATA%` still takes precedence. Regression: `tests/unit/guardrailsConfigResolution.test.js`.
- **The doctor's `standalone-bind` check reported the opposite of the truth** — it grepped for a string the patched entry never emits, hard-failing every correctly hardened build; it now keys on the preamble marker.
- **CI/CD runs locally, not on GitHub Actions** (owner decision): the gate is the local `npm run test:unit` / `test:e2e` / `node scripts/doctor.mjs` / `secrets-check` / `validate-open-core` chain in `docs/RELEASE.md`, driven by the project's own tooling. The `secrets-check` and `e2e-install` GitHub workflows are now **manual-dispatch only** (they no longer auto-fire on push/PR) — they had been generating failing runs and are redundant with the local gate. Publish/mirror/installer workflows (community publish, private mirror, Tauri build) are unchanged (tag-triggered, dormant).
- **`Dockerfile`/`docker-compose.yml` set `HOST=0.0.0.0` explicitly** (the new loopback default made containers unreachable from the host); release archives are platform-tagged (`zippymesh-router-v<version>-<platform>-<arch>.zip`); the Tauri bundle no longer carries `.env`/`bootstrap.secret`/`data/`; the false `npx zippymesh` install button and three never-built installer artifacts were removed from the download page and landing section.

### Changed — behaviour

- **`minTrustScore` now fails closed.** `src/lib/trustScore.js` returned a hard-coded `50` for every remote peer, making the control a placebo; it now returns `null` (unknown) and both routing gates reject an unknown peer when a threshold is set. An operator with `0 < minTrustScore <= 50` was silently admitting every peer and will now block them — which is what the setting asked for. Thresholds above 50 are unaffected.

### Known issues (for the next round)

- (Fixed — see the Fixed section: guardrail rules now ship in the standalone bundle.)
- A rare mid-stream-abort crash (`Controller is already closed`, no stack trace) observed under the ACP harness, not yet reproduced by a minimal case.
- **Login coarse ceiling is a shared bucket** (adversarial-verify residual V-2): without `TRUST_PROXY` every caller shares the `direct` peer, so a sustained flood of failures can trip the 100-failure coarse 429 for everyone. The per-account progressive backoff (the primary control) is unaffected and always lets the correct password through; a fuller fix (per-account ceiling, or gating the coarse count on confirmed failures only) is a next-round policy decision.

---

## v1.3.1 (2026-08-30)

*Patch release by policy: versions move by patch for maturity rounds like this one; a minor/major bump is reserved for large functional changes that have been tested across releases. Everything below landed on `dev-beta` after the v1.3.0 integration commit — the first block without a changelog entry at the time, the "Track A" blocks from the 2026-08-30 maturity round. Commit hashes are given so each bullet can be traced back to its diff.*

### Security

- **Scoped, revocable vault agent tokens** (`0ff513f7`): agents, crons and other non-interactive callers now read vault entries through a bearer token instead of the master password. `POST /api/vault/tokens` issues one — only its SHA-256 hash is stored — scoped to entry names or `*`, with an optional TTL; `DELETE /api/vault/tokens/[id]` revokes it immediately; every read is logged per token and entry.
- **New token-authenticated vault routes, contract frozen**: `POST /api/vault/read-with-token` (`{token, entry}` → `{ok, name, label, category, value}`) and `POST /api/vault/list-with-token` (`{token}` → `{ok, scopes, unlocked, entries[{name,label,category,tags,updated_at}]}`). Neither route uses a session; `src/middleware.js` now lets both through without a cookie. **These two routes are a frozen contract consumed by the Kiro Crew ZippyVault Bridge app — do not change request/response shape or status codes without coordinating that consumer.**
- **Vault rate limiting** (`src/lib/vaultRateLimit.js`, new): 60 requests/minute per presented token, plus a 30/minute auth-failure budget per peer to slow token guessing. `x-forwarded-for` / `x-real-ip` are honoured only when the new `TRUST_PROXY=1` env var is set (documented in `.env.example`) — off by default, since a caller-supplied header would otherwise let it pick its own rate-limit bucket. A locked vault is not counted as an auth failure. Errors carry a machine-readable `code` so HTTP status is never derived from message text (an entry name could otherwise steer a 403 into a 404).
- **Hardened MCP vault tools** (`src/mcp/zmlr-server.js`, `src/app/api/mcp/route.js`): `vault_get`, `vault_list` and `vault_store` now require the same scoped agent token — `x-zippyvault-token` header or a non-`sk-` bearer over HTTP, or `ZIPPYVAULT_TOKEN` (new `.env.example` entry) for a stdio process. A router API key (`sk-...`) no longer unlocks vault material through `/api/mcp`. `vault_status` stays open (returns no secret material). 79 new unit tests (`tests/unit/vaultTokens.test.js`, expanded `tests/unit/mcpServer.test.js`).
- **Vault master-password verifier + PBKDF2 600k** (`b9fa1247`): an initialized-but-empty vault now anchors a verifier at first write, closing a gap where it would accept any password as correct. PBKDF2-SHA256 iterations raised 210k → 600k (OWASP); the iteration count is version-tagged into the stored salt so existing 210k entries still decrypt and are re-wrapped at 600k on next write. `vault-totp.js` aligned to the same 600k count.
- **Vault/TOTP auth gaps closed** (`d2112227`): `requireAuth` added to `/api/vault` (unlock/lock) and `/api/vault/totp`; TOTP enrollment confirm now requires an unlocked vault and a verified passphrase, closing an enrollment-lockout DoS.

### Bug Fixes

- **Vault + TOTP modals never rendered** (`c1511250`, `cc6332c2`): the shared `Modal` component takes an `isOpen` prop with no `open` fallback (`if (!isOpen) return null`); the vault-keys page's five modals (unlock, add entry, read entry, TOTP enroll, TOTP disable) and several other pages (combos, profile, routing, providers, OAuth modals) were passing `open` and silently rendering nothing. All call sites renamed to `isOpen`.
- **Dashboard dead-ended on a stale session cookie** (`f61782f4`): `/dashboard` was classified as a management API, so an expired/invalid `auth_token` returned a JSON `{"error":"Unauthorized"}` 401 the browser couldn't recover from, instead of redirecting to `/login`. `/dashboard` is now handled purely as a page (redirects on auth failure); an invalid/expired token falls through to the `requireLogin` gate; the stale cookie is cleared so the browser stops replaying a dead session.
- **Provider-logo images 401ing** (`f61782f4`): `/api/providers/icon/[id]` is now public — `next/image`'s server-side fetch carries no session cookie, so gating the route behind auth made every provider logo 401 and silently fall back to the initials avatar.
- **"Get Started" checklist stuck below 4/4** (`dbebd927`): `GET /api/setup/status` checked `provider_connections.testStatus = 'success'`, a value nothing in the codebase writes — every real path (`connectionTester.js`, the provider test route, OAuth connect) writes `'active'`. Now checks `testStatus IN ('active', 'success')`.
- **Setup-wizard vault step could silently overwrite the just-set password** (`dbebd927`): choosing "Set up Vault" navigated straight to `/dashboard/vault-keys` without first calling `POST /api/setup/complete`, leaving `firstRun` `true`; any later visit to `/` restarted the wizard at step 1, whose password step (the `firstRun` bypass) has no current-password check and would overwrite the password just set. `finishToVault()` now completes setup before navigating.
- **Antigravity model sync always failed**: `PROVIDER_MODELS_CONFIG.antigravity.url` pointed at a typo'd host (`daily-cloudcode-pa.sandbox.googleapis.com`) that didn't match the endpoint used everywhere else in the codebase; corrected to `daily-cloudcode-pa.googleapis.com` with a fallback to `cloudcode-pa.googleapis.com`. (`dbebd927`; not mentioned in that commit's message — found while reading the diff.)
- **Anthropic OAuth model listing 401ed**: Anthropic rejects an OAuth access token sent via `x-api-key`; model listing now sends `Authorization: Bearer` for an OAuth token (an API key still goes via `x-api-key`) and adds the required `Anthropic-Beta: oauth-2025-04-20` header (`dbebd927`).
- **Peer actions called non-existent RPC methods** (`f5695b58`): `dialPeer` now POSTs the sidecar's real `POST /peers/connect` REST endpoint (Bearer auth) instead of a `zippycoin_dialPeer` RPC that always errored; `blockPeer` returns an explicit "unsupported" result instead of calling a phantom `zippycoin_blockPeer` RPC; a `zippycoin_closeChannels` call on `stop()` that could never succeed was removed.
- **`getPriceHistory("*")` literal-match bug** (`d2112227`): a wildcard price-history lookup was matched literally instead of returning all history.
- **ZMLR wallet/payments/providers incompatible with zippycoin-core chain 947** (`d2112227`, four-agent audit): sidecar RPC default corrected 8547 → 8545, with `rpc_url()` now centralizing and honoring `ZIPPYCOIN_RPC_URL` / `NEXT_PUBLIC_ZIPPYCOIN_RPC_URL` / `ZPC_RPC_URL`; the incompatible Ed25519 `0x...` keygen retired in favor of the sidecar's real `zpc1` ML-DSA wallet (`/api/mesh/wallet`, `WalletManager`, `/wallet/pubkey`); a real signed sidecar `POST /wallet/send` (fixed-point ZIP→ZAT) added so `/api/v1/wallet/send` works, mapping node errors to 402/424/400; on-chain settlement wired into `/api/mesh/infer` (`sendInferencePayment`); provider discovery now calls `zippycoin_getProviders` instead of a hardcoded mock; a signed `POST /provider/register` added (core requires an ML-DSA op signature) and `/api/mesh/exposed-providers` registers when `MESH_PUBLIC_ENDPOINT` is set; node-manager reads `zippycoin_peerCount` instead of the retired `net_peerCount`; trust score reads the real `trust_score` (defaulting to 0) instead of a hardcoded 95.

### Features

- **Routing skips known-dead models instead of failing into them** (`dbebd927`): the scoring engine (`src/lib/routing/engine.js`) now applies a lifecycle penalty larger than every other score term to a model the registry marks `missing` or `deprecated`; the failover manager drops such candidates; the smart router filters the merged catalog; combo chat (`open-sse/services/combo.js`) skips straight to the next model instead of burning a failing round-trip first. New tests: `tests/unit/comboLifecycleSkip.test.js`, additions to `tests/unit/routingScoring.test.js`.
- **Setup wizard vault step**: step 3 of `/setup` offers "Set up Vault" (see the completion-order fix above) alongside "Skip for now" (`dbebd927`).
- **CLI Tools nav no longer hidden behind Expert Mode** (`dbebd927`): the setup wizard's finish screen sends CLI users (Claude Code / Cursor / Codex) to `/dashboard/cli-tools`; that link was gated behind Expert Mode (off by default), making the instruction a dead end for a standard-mode user.
- **Dev-only ZippyCoin faucet** (`d2112227`): sidecar `POST /wallet/dev-fund` and `POST /api/v1/wallet/fund`, gated on the new `ZIPPY_DEV_FAUCET_SEED` env var (403 when unset in production); signs a transfer from an operator-funded wallet so payments can be exercised end-to-end without fabricating funds.
- **Price-history recording** (`b9fa1247`): provider-sync now records a price-history point whenever a model's input/output pricing actually changes, so the marketplace price-history endpoint has real data instead of an always-empty store. Auto-verified tokenbuddy submissions also mirror into `communityPriceSubmissions` with the same shape as the vote-verified path (`f5695b58`).
- **`POST /api/vault/bulk-import`** (`cc6332c2`): unlocks the vault and stores multiple entries in one handler, avoiding a dev-mode issue where separate route bundles could see different in-memory vault-unlock state.
- **`POST /api/models/lifecycle-check`** (`cc6332c2`): given `{pairs: ["provider/model", ...]}`, reports which are `missing`/`deprecated` in the model registry, so the UI can flag a stale reference saved in a combo or playbook (`/api/models/available` only returns active models, so a stale reference otherwise just vanishes from that list with no warning at the point it's used).
- **Dashboard TOTP flow** (`b9fa1247`): vault unlock gained a code field for accounts with 2FA enabled, plus an enable/disable panel with QR code, secret, and one-time backup codes.

### Configuration & Migration Notes

- **`DATA_DIR` default changed** (`dbebd927`): `.env.example` no longer ships `DATA_DIR=./data`. Left unset (the new recommended default), runtime data — password hash, vault entries, provider credentials, tokens, usage data — lives in the OS per-user directory (`%APPDATA%\zippy-mesh` on Windows, `~/.zippy-mesh` on macOS/Linux) instead of inside the source tree or app folder. **This changes the shipped example/default only, not existing installs**: an install that already has `DATA_DIR=./data` in its own `.env` is unaffected as long as that line stays. `scripts/check-env.js` still falls back to reading `./data/db.json` for a legacy install with no per-user store yet, but there is no automatic migration of `./data`'s *contents* into the per-user directory — an operator who wants to move to the new default has to relocate the directory manually.
- **New env vars documented in `.env.example`**: `TRUST_PROXY` (vault token-route rate limiting; see Security above), `ZIPPYVAULT_TOKEN` (MCP stdio vault auth), `ZIPPY_DEV_FAUCET_SEED` (dev-only faucet, off by default).

### Maintenance

- `chore: add AutoClaw-generated .clinerules agent steering` (`a2ec3a0d`): internal multi-agent coordination rules under `.clinerules/` (autobuild, cross-agent-protocol, cross-agent, doc-writer, intelligence, kdream, mateam, orchestrate, security-auditor). No runtime effect.
- `docs(internal): Kiro Crew integration handoff and roadmap` (`411986d9`): added `docs/_internal/KIROCREW_INTEGRATION_HANDOFF.md` (private origin only, excluded from the public build) — the goal, the contracts frozen between ZMLR and the Kiro Crew ZippyVault Bridge app, this round's maturity findings, and the roadmap tracks.

### Track A — platform maturity for the Kiro Crew bar (2026-08-30)

*Work from the maturity round described in `docs/_internal/KIROCREW_INTEGRATION_HANDOFF.md` §5. Detailed reports live in `docs/_internal/*_2026-08-30.md`.*

#### Security

- **Forged `x-real-ip` no longer bypasses the router API key** (`src/lib/auth/apiKey.js`): the "trusted LAN" bypass derived the client address from `x-real-ip` — a request header — so any caller could send `x-real-ip: 127.0.0.1` and skip the key. Proxy trust is now centralized in `src/lib/net/proxyTrust.js` (shared with the vault rate limiter): addresses from `x-forwarded-for`/`x-real-ip` are honoured only when `TRUST_PROXY=1`; otherwise the peer is unknown and the LAN bypass fails closed. `trustedLanCidrs` behaves exactly as before behind a declared proxy. `requireApiKey` off (the default) is unaffected.
- **Public `GET /api/settings` returned the node's ed25519 private key** (`nodeIdentity.privateKey`, written on first `/api/init`) and operator webhook auth headers. Both are now redacted (`hasPrivateKey` / `hasHeaders` booleans replace them); the public key and every other field are unchanged. `PATCH` echoes the same redacted shape.
- **Public `GET /api/cli-tools/openclaw-settings` returned every third-party API key** in the operator's `~/.openclaw/openclaw.json`. Credential-shaped values are now replaced with `__REDACTED__`; structure is preserved so the dashboard card still works.
- **`/api/v1/wallet/send` and `/api/v1/wallet/fund` had no authentication** (`/api/v1/**` is excluded from the edge cookie gate). Both now require a session or a database-verified router key.
- **`/api/mcp` tiered posture** (`src/app/api/mcp/route.js`, `src/mcp/zmlr-server.js`): read-only discovery tools remain callable with an edge-validated router key; tools flagged `mutating` (today `execute_with_routing`) require a revocation-aware identity — a live session or a router key verified against the database — because the edge can only check a key's HMAC, never revocation. Scoped keys need `*` or `mcp`. `GET /api/mcp` lists `mutatingTools`. Vault tools keep their strictly stronger agent-token gate.
- **Route audit + LAN threat model**: every `src/app/api/**` route classified by enforced auth and sensitivity in `docs/_internal/SECURITY_AUDIT_2026-08-30.md`; root `SECURITY.md` gained a "Network Exposure" section (bind host, `requireLogin`, `requireApiKey`, `TRUST_PROXY`). Headline open finding: the **built** `.next/standalone/server.js` is Next's stock template and binds `0.0.0.0` regardless of `ZIPPY_BIND_HOST` (fix tracked under the install audit below). New tests: `proxyTrust`, `apiKeyProxyTrust`, `mcpRoutePosture` (65).

#### Features

- **`zvault run -- <cmd>`** (`bin/zvault.mjs`, `docs/ZVAULT_RUN.md`; `npm run zvault`, package `bin`): dependency-free launcher that resolves `zvault://<entry>` / `{{zvault:<entry>}}` references (plus `--env NAME=entry` and `--map file.json`) through the frozen `read-with-token` route and injects the plaintext into a child process's environment only — the `op run` / `doppler run` pattern, so Claude Code, Cursor, Kilo and plain scripts get the same no-plaintext-in-transcript guarantee as the Kiro Crew bridge. Also `zvault check` / `list` / `get --stdout`. The token is never accepted as an argument. Exit codes: child's, 2 usage, 3 vault locked, 4 token rejected, 5 entry missing/out of scope, 6 unreachable, 7 rate limited (one `Retry-After` retry first). Windows `.cmd` shims are spawned through `cmd.exe` with cross-spawn-style quoting, no `shell:true`. 29 tests prove the parent never emits a value.
- **Runnable MCP stdio server** (`scripts/mcp-stdio.mjs`, `src/mcp/stdio/`, `docs/MCP_STDIO.md`; `npm run mcp:stdio`): the README's "add ZMLR as an MCP server in Claude Code / Cursor" story is now a real process. A Node resolve hook maps the `@/` and `open-sse` aliases; a JSON-RPC 2.0 loop implements `initialize`, `ping`, `tools/list` (with `readOnlyHint` annotations from the `mutating` flag) and `tools/call`; stdout is reserved for the protocol (library logging is redirected to stderr, and the server's own hooks now log to stderr). With `ZMLR_URL` set, `vault_status`/`vault_list`/`vault_get` proxy to the running server's token routes so the vault unlock lives where the user performed it; `vault_store` stays local and is documented as unavailable over stdio (no `store-with-token` route exists — the two token routes are frozen). 36 tests.
- **`zmlr doctor`** (`scripts/doctor.mjs`, `scripts/doctor/checks.mjs`, `docs/DOCTOR.md`; `npm run doctor`, `npm run cli -- doctor` — `scripts/zippy-cli.mjs`, referenced by package.json since v1.2, now exists): 15 injectable checks — Node version, install context, `.env`/`JWT_SECRET`, bind host, `PORT` vs `ZIPPY_PORT`, data dir (writable probe), `db.json`, SQLite schema/`user_version`, `TRUST_PROXY`, `router-config.json` location, standalone build age vs HEAD, **built-server bind host** (fails when the stock `0.0.0.0` template meets `requireLogin:false`), live `/api/health`, vault state, local provider reachability (no key ever read or printed). `--json` for CI; exit 1 on any failure. 72 tests.
- **`/api/health` for supervisors**: additive fields `vault{initialized,unlocked}`, `dataDir{configured,writable}`, `trustProxy`, `bindHost{loopbackOnly}`, `db{ok,schemaVersion}`, `build{version,standalone,nodeVersion}`, plus `HEAD`. Every pre-existing field is byte-identical; nothing path- or host-shaped is added to this unauthenticated route. 18 tests.

#### Maintenance

- **Test runners can no longer touch the real store**: `vitest.config.js` gains `setupFiles: tests/unit/_setup/dataDir.mjs`, which points `DATA_DIR` at a fresh temp dir (one per test file) and sets `JWT_SECRET` / `ZIPPY_OFFLINE=true` before any `src/` import; `npm test` and `npm run test:providers` preload `tests/_env.cjs` the same way. `tests/unit/dataDirIsolation.test.js` asserts the isolation and that no file under `%APPDATA%\zippy-mesh` is modified during a run. Previously `npm test` without `DATA_DIR` ran the SQLite migrations against the operator's real store.
- `package.json`: `engines.node >= 20` declared (was absent; npm would install on Node 18 silently).
- Release process rewritten: `docs/RELEASE.md` is now an ordered, gated checklist (unit → production-build e2e → doctor → open-core validation → tag); `docs/_internal/RELEASE_PLAN_1.4.0.md` argued for a minor bump and proposes the CI gates; the owner chose patch-level versioning (see the banner in that file).
- Kiro Crew ecosystem drafts (private, unpublished): `docs/_internal/kirocrew/` — the "route Kiro Crew to your own models" guide, the App Store listing request against the upstream template, and the ZippyCoin participation proposal.

#### Security (found by the new e2e suite)

- **Login lockout was bypassable by rotating `x-forwarded-for`** (`src/app/api/auth/login/route.js`): the 5-per-15-minute bucket was keyed on caller-written headers and ignored `TRUST_PROXY`, so a guesser with a fresh header per try never tripped it (measured: 12 wrong passwords, all 401). It is now keyed on `clientPeer()` — the shared "direct" bucket unless a trusted proxy asserts the address — and counts only **failed** attempts; a successful login clears the streak, so legitimate callers sharing the coarse bucket cannot lock each other out. `requireAuth()`/`requireRole()`'s 300/min dashboard bucket keys on the same peer. `src/lib/auth/ipRateLimit.js` gains `peekIpRateLimit` / `recordIpRateLimitHit` / `clearIpRateLimit`. Regression: `tests/unit/loginLockout.test.js`.

#### Testing

- **Production-build e2e suite for the vault token routes** (`scripts/e2e/run-standalone.mjs`, `tests/e2e/vault-tokens/`, `tests/e2e/_lib/client.mjs`; `npm run test:e2e`): dependency-free runner that starts the built `.next/standalone` server on a throwaway `DATA_DIR` with a random `JWT_SECRET`, waits for `/api/health`, runs `node --test` suites, kills the server and removes the data dir. 72 cases / ~300 assertions across four isolated server passes (`core`, `limits`, `authfail`, `proxy` with `TRUST_PROXY=1`): first-run + login, unlock/lock, token issue/list/revoke/expiry, exact response key sets of both frozen routes, 401/403/404/400 mapping, the literal `"Vault is locked"` text, locked-vault reads not consuming the auth-fail budget, 60/min per-token and 30/min per-peer limits with `Retry-After`, middleware pass-through without a cookie, `/api/mcp` vault tools with and without a token, and leak checks (no value / token / hash / fingerprint in any response or in the server log). Run with `--suite`, `--filter`, `--port`, `--env K=V`, `--keep`. Asserts the operator's real store is untouched. Report: `docs/_internal/E2E_VAULT_TOKENS_2026-08-30.md`.
- `playwright.config.cjs` now sets `testMatch: '**/*.spec.cjs'` so the browser flow no longer picks up the node:test files.
- Repo-root `bootstrapEnv.cjs` had unresolved merge-conflict markers (three hunks from the `origin/ZippyMesh_LLM_main` merge), so `node run.js` from a source checkout could not start; replaced with the clean `scripts/bootstrapEnv.cjs` that `prepare-standalone` actually ships.

#### Features (dashboard)

- **Agent Tokens panel on the Vault page** (`src/shared/components/vault/AgentTokensPanel.js`, `agentTokensApi.js`, `agentTokenLogic.js`): the token routes existed since `0ff513f7` but had no UI, so a Kiro Crew user had to issue a token from browser devtools. The panel lists active tokens (name, scope chips, created, expires, last used) with confirm-to-revoke, and an Issue modal with a scope picker (entry checkboxes or "All entries (\*)" — the only scope that may write), a TTL select (never / 1 h / 24 h / 7 d / 30 d / 90 d), and a one-time reveal with Copy and a "shown once" warning; the raw token lives only in the reveal reducer's `revealed` state and is dropped on Done/close/Escape — never logged, stored or put in a URL. Issuing works on a locked vault (only reads need an unlock), and the panel says so. 50 tests.

#### Testing (routing)

- **Production-build e2e suite for the OpenAI-compatible surface against a real local Ollama** (`tests/e2e/routing/`, `npm run test:e2e:routing`; the runner accepts `ZMLR_E2E_DIST_DIR=.next-foo` to test an isolated build made with `ZIPPY_NEXT_DIST_DIR`): 66 checks — provider registration and `/v1/models` shape and ids, non-stream and stream `/v1/chat/completions` shapes (SSE framing, `[DONE]`), multi-turn, `temperature`/`max_tokens`, tool calls, JSON mode, error envelopes, `X-Intent`/`x-routed-*` headers, and `requireApiKey` on/off with a real router key. The measured behaviour of the surface, with every deviation from the OpenAI spec pinned to `file:line`, is in `docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md` — the document the Kiro Crew ACP harness (Track B) will code against. Report: `docs/_internal/E2E_ROUTING_2026-08-30.md`.

#### Install & packaging (from the install-from-scratch audit — `docs/_internal/INSTALL_AUDIT_2026-08-30.md`)

- **The release zip was unfollowable**: every entry point `docs/SETUP.md` named (`start-stable.cmd`, `start-stable.sh`, `run-standalone.cmd`, `.next/standalone/server.js`, `scripts/`) was absent from the artifact. `scripts/prepare-standalone.cjs` now generates the launch scripts into the bundle; `start-stable.sh` exists (it never had); `run-standalone.cmd` is an alias of `start-stable.cmd`.
- **Built server bound `0.0.0.0:3000` with a stock `.env`**: the generated `.next/standalone/server.js` is Next's template (`HOSTNAME || '0.0.0.0'`, `PORT || 3000`) and the hardened repo-root `server.js` never shipped. `prepare-standalone.cjs` now patches the generated entry to resolve the bind host like `src/lib/net/bindHost.js` (loopback default, `ZIPPY_BIND_HOST`/`HOST`, exposure warning when non-loopback with login disabled) and **fails the build** if the patch cannot be applied; `--patch-server <dir>` repairs an existing bundle. `start-stable.cmd`/`.sh` default to loopback with an explicit `--lan` opt-in and honour `ZIPPY_ENV_FILE`. Verified: `127.0.0.1:20320 LISTENING` from a clean unpack; `--lan` → `0.0.0.0` + warning.
- **`.next/standalone/data` symlink into the operator's real `%APPDATA%\zippy-mesh`** is now opt-in instead of created on every build; `scripts/package-release.cjs` zips with `--symlinks`, excludes `.env`/`data`/`bootstrap.secret` on both platforms (previously only on the PowerShell path), and runs a post-zip secret scan that deletes the archive and exits non-zero on a hit. (`next build` copies the operator's `.env` into the standalone dir — Next's behaviour — which this scan now catches.)
- **`scripts/setup-env.mjs` (predev/prebuild) rewritten**: honours `DATA_DIR` for `router-config.json` exactly like `src/lib/localDb.js` (they previously disagreed, splitting secrets across two directories); `--no-env` / `ZIPPY_SETUP_NO_ENV_WRITE=1` skips all `.env` writes; byte-identical re-runs no longer touch mtimes; an existing `INITIAL_PASSWORD` is never downgraded; prints a `Did:`/`Skipped:` summary. macOS data dir fixed.
- `docs/SETUP.md`, `docs/RUNNING.md`, `docs/build-from-source.md`, `docs/STANDALONE_README.md`, `docs/INSTALLER_MATRIX.md` rewritten against what was actually verified: Windows release-zip install passes end-to-end (unpack → `.env` → `start-stable.cmd` → first-run → login → Ollama → `/v1/models` → a real completion); Linux build-from-source passes (WSL2 Ubuntu, Node 24; inference untested there because Windows Ollama is loopback-only); macOS untested. `PORT` is the bind port (default 20128 in the shipped scripts); `ZIPPY_PORT` is only the advertised mesh port. `docs/INSTALLER_MATRIX.md` and `docs/API.md` were linked from SETUP.md but never tracked — now whitelisted.
- `engines.node` tightened to `>=20.9.0` (Next 16's floor).
- **Router API keys no longer die on restart**: `API_KEY_SECRET` (the HMAC key behind every `/v1/*` router key) was never provisioned — `.env.example` ships it empty and `src/shared/utils/apiKey.js` then falls back to a random per-process value, so every key an operator issued stopped verifying after a restart. `scripts/setup-env.mjs` now generates and persists it in `router-config.json` and fills an empty `.env` line (an operator-set value is never rotated); the standalone entry preamble and `run.js` call `bootstrapEnv.ensureApiKeySecret()`, which generates it once into `<data dir>/bootstrap.secret` and reuses it thereafter. `setBootstrapSecrets()` now merges instead of clobbering the file. Regression: `tests/unit/bootstrapEnvApiKeySecret.test.js`.

#### Routing & OpenAI-compatible surface (found by the routing e2e suite; contract in `docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md`)

- **`model:"auto"` and every playbook id 404ed on a production build** — the README's headline example. Three independent causes fixed: `smartRouter.js` returned `null` constraints that `recommendationService.js` threw on; `chat/completions/route.js` cloned the request with `new Request(nextRequest, init)`, which throws cross-realm (`Cannot read private member #state`), so the rewritten `model` never reached the handler and the literal `"auto"` went upstream; and with no `PROVIDER_MODELS["ollama"]` the orchestrator had no default for a local-only install. Now: `auto` returns 200 with a real completion; `x-selected-model` (provider-qualified) and `x-routed-model` (provider-local) are set on the **success** path (previously only on failures); the new `src/lib/routing/localModelIndex.js` (TTL-cached index of what local runtimes serve) backs `pickLocalDefaultModel()` and bare-tag resolution. Smart routing fires only for `model === "auto"`; a body with no `model` is still `400 Missing model`.
- **Registering a local Ollama took a 240 s LAN sweep** (`POST /api/discovery` scanning every /24 of every interface, registering the same Ollama twice as 127.0.0.1 and localhost). New fast path: `POST /api/provider-nodes { type:"local", apiType:"ollama"|"lmstudio"|"llamacpp"|"openai-compatible", baseUrl?, name? }` probes once (5 s timeout), registers through the same code path as discovery (`registerLocalRuntime`, now shared), dedupes by normalized host:port (127.0.0.1 ≡ localhost ≡ ::1), and is routable immediately — 131 ms measured. The sweep remains as a fallback and no longer double-registers.
- **`GET /v1/models`** took 7–28 s, fetched `api.kilo.ai` on every call regardless of configuration, listed 475 models an unconfigured install could not serve, and ignored `requireApiKey`. Now: only configured providers' and registered nodes' models (88 vs 546 here; `?all=1` / `?catalog=1` returns the full catalogue — the dashboard's provider-detail and routing-rules pages use it), remote catalogue cached 10 min and never fetched under `ZIPPY_OFFLINE=true`, provider sync non-blocking, `requireApiKey` enforced with the standard envelope; 98 ms cold / 12 ms warm.
- **`usage.prompt_tokens`/`total_tokens` were inflated by a fixed +2000** (`open-sse/utils/usageTracking.js`) on every client-facing response, breaking any cost accounting including ZMLR's own ledger. The response now carries the provider's real numbers (verified byte-equal to Ollama's `prompt_eval_count`/`eval_count`); the padding is opt-in via `ZMLR_USAGE_BUFFER_TOKENS`; a new `x-zmlr-usage` header says `provider` | `none` | `padded` | `stream` (streaming usage remains an estimate flagged `usage.estimated:true`).
- **Prompt cache served a JSON-mode request the cached plain answer** — the key covered only `{model, messages, temperature, max_tokens}` (`src/lib/promptCache.js`). The key now hashes the whole request minus `{stream, stream_options, user, metadata}`; requests with `tools` or `n > 1` are never cached (replaying `finish_reason:"tool_calls"` would re-trigger a client side effect); a HIT mints a fresh `id`/`created` and is signalled only by `x-cache: HIT`.
- **Reasoning deltas were dropped from streams** — the filter accepted `reasoning_content` but Ollama sends `reasoning` (`open-sse/utils/streamHelpers.js`, `stream.js`): a 107-frame Ollama stream reached the client as 5 frames and time-to-first-content was sometimes `null`. `reasoning`/`thinking`/`thought` are now normalised to `delta.reasoning_content`; `delta.content` is unchanged. Measured 5 → 402 frames.
- **`response.model` was the provider-local tag** (`qwen3.5:4b`) and round-tripping it 404ed. Non-stream responses and every stream chunk now echo the provider-qualified id that was sent (`ollama/qwen3.5:4b`); the bare tag also resolves on `/v1/chat/completions` when exactly one provider serves it.
- **`POST /v1/embeddings` did not exist** (HTML 404). Implemented (`open-sse/handlers/embeddingsCore.js`, `src/app/api/v1/embeddings/route.js`): OpenAI shape, `float`/`base64`, batch input, Ollama (`/api/embed`), LM Studio / OpenAI-compatible nodes and OpenAI, bare ids resolved against local runtimes, same `requireApiKey` gate as chat. 15 e2e checks (`tests/e2e/routing/08-embeddings.test.mjs`); single input 79 ms, 768-dim vector.
- **Every `/v1/*` path now answers the JSON error envelope** — a catch-all `src/app/api/v1/[...path]/route.js` returns `404 {error:{code:"unknown_endpoint"}}` instead of Next's HTML page, so SDKs fail at the envelope, not at parse.
- New tests: `smartRouterAuto` (15), `providerNodesLocal` (30), `v1Models` (16), `usageTracking` (17), `promptCacheKey` (34), `streamReasoning` (19), `embeddingsRoute` (38).

- **"Add a local runtime" card** (`src/shared/components/providers/AddLocalRuntime.js`): Ollama / LM Studio / llama.cpp / OpenAI-compatible picker with the runtime's default URL prefilled, one click → the fast `POST /api/provider-nodes {type:"local"}` path → lists the models found and says they are routable as `ollama/<tag>` and via `auto`; actionable hints on 502 (`ollama serve`, LM Studio → Developer, `llama-server …`). Mounted at the top of Dashboard → Providers and as the **first** option in the setup wizard's "Connect a provider" step. "Scan Local Network" is demoted to a secondary "slow (minutes)" link. 55 tests.

- **Token ledger recorded 0 input/output tokens for every request ever made**: `handleChatCore` never returned `usage`, so `recordTokenUsage` in the orchestrator wrote zeros. `chatCore` now returns the provider's real usage on its result (non-stream: snapshotted before any opt-in padding; stream: the final-chunk estimate via a pass-through `TransformStream`, settled asynchronously so bytes to the client are unchanged) and the orchestrator writes it. Verified on a production build: 39 completions → 39 non-zero rows. `tests/unit/ledgerUsage.test.js` (11). Known gaps: no `estimated` column in `token_ledger`; an aborted stream writes no row; `/v1/embeddings` and batch chat still write none.
- `tests/e2e/routing` reconciled to the post-fix contract — 88 checks, all green on a clean build (registration 61 ms; `/v1/models` 55 ms cold / 12 ms warm; stream 333 frames). `tests/e2e/zmlr.spec.cjs` no longer asserts a `zpc1` key prefix that no code path ever produced.

---

## v1.3.0 (2026-07-03)

### Bug Fixes
- **Password-recovery deadlock**: if an install's stored password ever got cleared/migrated without `firstRun` being reset to `true`, the instance became permanently unauthenticatable — `/login` redirected to `/setup` (based on `hasPassword===false`), but `/setup`'s own unauthenticated write to `PATCH /api/settings` was rejected with 401 (gated on the stale `firstRun===false` flag instead). `PATCH /api/settings` now also treats "no password stored yet" as first-run, so this class of drift self-heals instead of locking the owner out. Security posture is unchanged once a password exists — unauthenticated writes are still rejected (see regression test `tests/unit/settingsPasswordRecovery.test.js`).

### Security
- Dependency audit pass: resolved 10 of 14 flagged advisories via `npm audit fix` (production scope now 4 remaining, all moderate/low severity, gated behind major-version bumps in editor/build tooling — tracked, not force-applied to avoid a breaking downgrade).
- Open-core boundary re-validated end to end: `validate-open-core --tree=community-dist` now passes with zero proprietary, internal, or leak-pattern findings (previously 2 leak-pattern violations — a stray internal dev path and a private-range IP fixture in a test — both fixed at the source).

### Maintenance
- Full local validation pass: `secrets-check`, router-key test suite, and all 381 unit tests green.
- Clean rebuild of the standalone app and community distribution from scratch.

---

## v1.2.1 (2026-05-16)

### Security
- **Auth gate on PATCH /api/settings**: route now requires a valid `auth_token` cookie when `firstRun=false`, blocking unauthenticated settings writes (including direct `password` field injection that bypassed bcrypt).
- **Block direct password field writes**: `body.password` is deleted unconditionally before any processing in the PATCH handler; credentials must go through the `newPassword`/bcrypt path.

### Bug Fixes
- **Setup wizard redirect loop**: `/setup` now detects `firstRun=false && hasPassword=true` on mount and redirects to `/dashboard`, preventing re-entry into the wizard after setup is complete.
- **`[object Object]` error in setup wizard**: the password-save error handler now uses `data.error?.message` (matching the `{ error: { message } }` envelope from `apiError`) instead of rendering the raw error object as a string.

---

## v1.2.0 (2026-05-11)

### Routing & Provider Compatibility
- **Provider response sanitisation**: new `sanitizeProviderResponse()` in `src/utils/guardrails.js` strips non-standard provider fields, extracts reasoning into OpenAI-style top-level fields, and normalises usage shape across all providers.
- **OpenAI-spec stream default**: chat completions now respect `stream === true` only (previously force-enabled streaming for openai/codex). Aligns with the OpenAI SDK default.
- **Role normalisation**: `developer` role is translated to `system` universally. For GLM and ERNIE targets (which don't accept system messages), `system` is translated to `user` before the request reaches the upstream.
- **Gemini structured output**: `response_format: json_object`, `json_schema`, and `text` are now translated into Gemini's `generationConfig.responseMimeType` and `responseSchema`. Lets a client request structured output from Gemini using the OpenAI shape.
- **Sidecar binary discovery**: `zippy-node-manager.js` now searches multiple candidate paths and uses the correct `zippy-mesh-sidecar` binary name; fixes "node not found" errors on standalone builds.

### Mesh
- **Live node-status probe**: new `GET /api/node/status` makes a fresh HTTP probe to the sidecar `/health` endpoint on every request (2s timeout). Replaces the in-memory singleton that lost state on HMR. Fixes the "NODE toggle shows Offline even when RPC is alive" bug.
- **meshMode persistence**: new `GET`/`POST /api/settings/mesh` persists `meshMode` (private | cluster | public) and `meshAllowlist`. Profile page exposes the toggle and allowlist textarea.
- **Sidecar address derivation**: `derive_zpc1_address` in `sidecar/src/main.rs` now uses HRP `"zpc"` + first 20 bytes of SHA3-256, matching `zippycoin-core` canonical formula. Unblocks `register_pubkey_with_node` against the live v2.0.0 chain.

### Security & Operations
- **TOTP second factor for vault unlock** (commit `f3331332`).
- **UI fixes**: providers stuck loading, sidebar duplicate nav tabs (commit `2a79ea3a`).

### Open-Core Hardening
- `.zippy-private` is now the single source of truth for proprietary paths (11 entries: routing engine, sidecar client, translators, wallet, trust score, discovery, plus 3 dashboard pages). `scripts/validate-open-core.cjs` was rewritten to read it directly (was hardcoded to 4 of the 11).
- New leak-pattern scan in `validate-open-core`: regex-matches internal IPv4 ranges (excluding RFC1918 CIDR notation), internal hostnames, and developer paths across shippable text files. Supports `--tree=community-dist` to validate the built output.
- `scripts/build-community.cjs` EXCLUDE expanded from 5 to 26 directory names plus 18 filename regexes (`.env*`, `*.log`, `*.bak`, `*.sqlite*`, `oauth-secrets.json`, `db.json`, `*.resolved*`, etc.).
- `.github/workflows/publish-community.yml` now runs `validate-open-core --tree=community-dist` as a hard gate before any push.
- `.github/workflows/release-tauri.yml` now triggers on `v*` tag push so installers build in parallel with the open-core publish.

### Repository Organisation
- New `docs/_internal/` convention: internal-only docs (plans, session reports, ops runbooks) are tracked in the private `origin` remote so devs share context, but `build-community.cjs` excludes them from `community-dist` so they never reach the public repo. Moved 14 root-level docs into this directory.
- Removed 10 tooling-spew files from repo root (debug logs, cargo output, diff dumps, accidental `null`).
- Removed 8 stale `.bak` files under `src/app/(dashboard)/dashboard/`.
- `.gitignore` now excludes `.kilocodemodes` and `pnpm-lock.yaml`; `*.exe` and `*.bin` already excluded for `src-tauri/binaries/`.
- Replaced stale root `ARCHITECTURE.md` with a redirect to the canonical `docs/ARCHITECTURE.md`.
- Source code: 4 mesh API routes and `provider-discovery.js` had hardcoded fallback RPC URLs pointing at an internal-network address; changed to `localhost` defaults. Env var `NEXT_PUBLIC_ZIPPYCOIN_RPC_URL` still takes precedence in production.

---

## v1.1.0 (2026-04-25)

### Mesh Networking (P1.1 – P1.6)
- Model degradation tracker with 3-strike backoff (5m → 15m → 30m → 1h).
- Model health prober: 5-min recovery probes for degraded models, 30-min health probes for healthy models.
- Mesh heartbeat: 30s UDP broadcast with model/metrics payload + `/api/mesh/heartbeat`.
- Peer state: CRDT SQLite `mesh_peers` table with 90s expiry + `/api/mesh/peers`.
- `meshMode` setting enforced in peerState listener (private | cluster | public).
- Peer routing score: `(1/ttft) × (1 - errorRate) × trustScore` formula; degraded peers excluded from candidates.
- Token ledger: SQLite `token_ledger` table with virtual-key / client-id bucketing for multi-tenant billing.

### Sidecar
- Wallet persistence via atomic tmp+rename to `$LOCALAPPDATA/zippy-mesh/wallets.json`.
- ML-DSA-65 (FIPS 204) wallet signing for `sendInferencePayment` transactions.
- `/proxy/chat/completions` forwards to operator's local Next.js `/v1/chat/completions`, reconciles cost against `usage.total_tokens`, refunds on upstream failure, signs response with Ed25519.
- `/dashboard/network` Publish-to-Mesh flow gates on a privacy-disclosure modal.

### Other
- Native `zippycoin_*` RPC migration: no more `eth_*` in the JS codebase.
- Inference payment wiring at 1000 ZAT/token.
- On-chain provider registration via `zippycoin_registerProvider`.
- `T15`: consumer-side mesh rate-limit filters.

---

## v0.5.0-beta (2026-03-19)

### Data Persistence & Migration
- **Automated Directory Migration**: Automatically moves user data from legacy `~/.zippymesh` to new standard `~/.zippy-mesh` on first run.
- **SQLite Configuration Sync**: Expanded `ensureSqliteSync` to migrate `apiKeys` and `routingPlaybooks` from legacy JSON to SQLite.
- **Onboarding Reliability**: Fixed middleware issues that caused onboarding loops and improved JWT secret generation for fresh installs.
- **Stability**: Added early-sync triggers in `getSettings()` to ensure data is ready before UI interaction.

---

## v1.0.0 (2026-03-18)

### Enterprise Ready — Full Milestone 5

**Multi-Tenancy (Task 5.1)**
- Organizations and teams hierarchy: `organizations`, `teams`, `tenant_members` tables
- RBAC middleware (`src/lib/auth/rbac.js`): `hasRole()`, `resolveTeamContext()` for role-gated API access
- Virtual keys now carry `team_id` and `org_id` (auto-migrated)
- `/api/orgs/` nested REST API: orgs → teams → members with role validation (admin/operator/viewer)
- Teams management UI at `/dashboard/teams` (expert mode): org panel, team panel, member expansion, create modals

**Advanced Compliance (Task 5.2)**
- `audit_log` table: append-only record of all settings changes and GDPR deletions
- `access_log` table: per-request access trail for SOC2 path
- `writeAuditLog()` called automatically on settings PATCH
- Configurable trace retention: `POST /api/compliance/retention` with on-demand purge
- GDPR right-to-erasure: `POST /api/compliance/gdpr` hard-deletes all data for a virtual key
- Compliance dashboard at `/dashboard/compliance`: Audit Log / Data Retention / GDPR tabs (expert mode)

**SLA Monitoring (Task 5.3)**
- `sla_events` table: per-request latency + success events per provider
- `sla_config` table: per-provider uptime target, P95 target, auto-disable threshold
- `recordSlaEvent()` wired into every request in `/v1/chat/completions`
- `getSlaStats()`, `getSlaPctLatency()`, `upsertSlaConfig()`, `disableProviderSla()`, `enableProviderSla()`
- `src/lib/slaMonitor.js`: `checkSlaBreaches()` and `generateWeeklySlaReport()`
- SLA API: `GET /api/sla` (per-provider stats + P95), `GET /api/sla?report=weekly`, `POST /api/sla` (config/enable)
- SLA dashboard at `/dashboard/sla`: provider cards with uptime %, avg/P95 latency, re-enable button (expert mode)

**Community Marketplace (Task 5.4)**
- `marketplace_playbooks` table with downloads, rating, author, tags
- 5 built-in seed playbooks: Cost Optimizer, Privacy First, Code Expert, Low Latency, OpenRouter Only
- `marketplaceSeed.js` runs on init (idempotent)
- `/api/marketplace/playbooks/`: list (filter/sort/paginate), publish; `[id]`: get, download, rate
- Community Playbooks tab added to `/dashboard/marketplace`

**Virtual Key Enforcement**
- `/v1/chat/completions` now validates `zm_live_...` Bearer tokens: 401 on invalid/inactive key, 429 on budget exceeded
- `virtual_key_id` column added to `request_traces` (auto-migrated)
- `saveRequestTrace()` records which virtual key was used
- `updateVirtualKeyUsage()`: token/dollar counters with monthly auto-reset
- `checkVirtualKeyBudget()`: checks token budget, dollar budget, and expiry
- `purgeVirtualKeyData()` now hard-deletes the key and all linked traces (GDPR-complete)

---

## v0.7.0 (2026-03-18)

### Open Source Launch — Milestone 4

**Repository Split & Build Automation (Task 4.1)**
- `.zippy-private` manifest: declares all proprietary source paths
- `stubs/community/`: interface-compatible community stubs for all Pro features (network, wallet, monetization pages; wallet-management lib)
- `scripts/build-community.sh`: rsync + stub replacement + .env.example sanitization + `npm run build:next` verification
- `.github/workflows/publish-community.yml`: triggered on `v*` tags; runs tests, builds, health-checks, force-pushes to `community` branch, creates GitHub Release tagged `v*-community`

**Plugin Architecture (Task 4.2)**
- Plugin scan: `~/.zippy-mesh/plugins/` scanned on startup via `initPlugins()`
- `validatePlugin()`: enforces manifest schema (type, name, version, description)
- Three plugin types: `provider`, `guardrail`, `routing-rule`
- `getPlugins()`, `getPlugin()`, `getPluginProviderModels()`, `runGuardrailPlugins()`, `getPluginScoreAdjustments()`
- Reference provider plugin at `src/plugins/example-provider/`
- `initPlugins()` and `seedMarketplace()` called from `/api/init`

**Documentation Site (Task 4.3)**
- VitePress site at `docs/` with standalone `package.json`
- 6-section sidebar: Getting Started, Configuration, API Reference, Smart Routing, Plugins, Deployment
- GitHub Pages deployment workflow at `.github/workflows/docs.yml`

---

## v0.6.0 (2026-03-18)

### Unique Differentiation — Milestone 3

**Request Tracer UI (Task 3.1)**
- `request_traces` table: full per-request audit trail (model, latency, fallback depth, cache hit, intent, constraints)
- `saveRequestTrace()` called in completions route
- Tracer UI at `/dashboard/tracer` (expert mode): live table with intent/model filters, expandable trace detail, flag/unflag

**Cost Simulator (Task 3.2)**
- Dry-run endpoint: `POST /api/routing/simulate` — runs full routing selection without executing the LLM request
- Returns: selected model, scoring breakdown, full fallback chain
- Simulate button in Playbook Builder UI

**Prompt Library (Task 3.3)**
- `prompt_templates` table with tags, favorites, insert-count tracking
- CRUD API at `/api/prompts/`
- Prompt Library UI at `/dashboard/prompts` (expert mode): search, tag filter, favorites, insert-to-chat

**Semantic Cache (Task 3.4)**
- `cache_embeddings` table: per-hash Ollama embedding vectors
- `trySemanticCache()`: SHA-256 exact match first, then cosine similarity via `nomic-embed-text` (768-dim)
- `storeEmbedding()`: fire-and-forget background embedding after cache store
- `X-Cache: SEMANTIC-HIT` response header
- Settings toggle: `semanticCacheEnabled` (off by default)

**Log Export Webhooks (Task 3.5)**
- `dispatchWebhookEvent(event, payload)`: fire-and-forget with 3 retries + exponential backoff (0s, 1s, 5s), 5s timeout
- Delivery history ring buffer (50 entries)
- `testWebhook(url, headers)`: connectivity check endpoint
- Webhook management API at `/api/settings/webhooks/` and `/api/settings/webhooks/[id]/`
- Webhooks tab in Settings UI

**Routing Memory ML Enhancement (Task 3.6)**
- `routing_decisions` + `routing_preferences` tables
- `analyzeRoutingMemory()`: per-intent model success rates from last 24h, normalized to score bonuses
- `getModelBoost(model, intent)`: feeds into `engine.js` scoring; 1-hour result cache; min 10 samples
- `resetAnalysisCache()` wired to `DELETE /api/routing/metrics`
- Routing Intelligence panel in `/dashboard/analytics`
- Live analytics page: replaces static charts with real routing data from `/api/routing/metrics`

---

## v0.5.0 (2026-03-18)

### Feature Parity — Milestone 2

**Expert / Developer Mode Toggle (Task 2.1)**
- `useExpertMode()` hook with localStorage persistence
- Expert toggle in sidebar; hides advanced nav items (Tracer, Cost Simulator, Prompt Library, SLA, Compliance, Teams) for standard users

**Virtual API Key Management (Task 2.3)**
- `virtual_keys` table: per-project keys with monthly token/dollar budgets, RPM limits, allowed providers/models
- `createVirtualKey()`: generates `zm_live_...` key (plaintext returned once), stored as SHA-256 hash
- Full CRUD API at `/api/virtual-keys/`
- Virtual Keys dashboard with copy-on-create, budget bars, revoke

**Setup Completion Checklist Widget (Task 2.4)**
- Persistent checklist on overview until all steps complete: connect provider, set password, make first request, configure routing
- Auto-dismisses when all conditions met

**Playbook Export / Import (Task 2.6)**
- Export routing playbooks as JSON; import from file with validation
- Export/import buttons in Playbook Builder

**PII Guardrails Default Patterns (Task 2.7)**
- Default active patterns: email, credit card, SSN, phone, API key regex
- Applied to every request in completions route; blocked requests return 400
- Guardrails toggle in Settings

**OpenRouter as Meta-Provider (Task 2.8)**
- OpenRouter connector supports dynamic model listing
- Kilo Code provider integration with free-model flag propagation

---

## v0.4.0 (2026-03-18)

### Production Credibility — Milestone 1

**Critical Bug Fixes (Task 1.1)**
- Fixed missing `await` on `response.json()` in `smartRouter.js:273`
- Replaced hardcoded `"zippymesh-api-key-secret"` with ephemeral fallback + warning
- Updated chain ID comment 777 → 947 (ZIP) in `zippycoin-wallet.js`

**Per-Request Trace Logging (Task 1.2)**
- `request_traces` table with full audit trail
- `saveRequestTrace()` wired into completions route

**Exact-Match Prompt Cache (Task 1.3)**
- `prompt_cache` table: SHA-256 keyed, TTL-aware
- `tryGetCache()` / `storeInCache()` in completions route
- `X-Cache: HIT` response header; cache management API

**Playbook Simulation / Dry-Run (Task 1.4)**
- `POST /api/routing/simulate`: full routing selection without LLM execution
- Returns selected model, score, fallback chain

**Playbook Template Gallery (Task 1.5)**
- Pre-built playbook templates browsable and importable in Playbook Builder UI

**Developer Quick-Start Page (Task 1.6)**
- `/dashboard/quickstart`: copy-paste curl/Python/JS examples pre-filled with server URL

**X-Headers Documentation (Task 1.7)**
- `/dashboard/endpoint`: full X-header reference (X-Intent, X-Max-Latency-Ms, X-Prefer-Free, etc.)

**ZippyMesh Discovery API (Task 1.8)**
- `/api/discovery/catalog`: full model catalog with capability detection (vision, code, reasoning, embedding, free)
- `/api/discovery/recommend`: intent + constraint → ranked model recommendations
- `/api/discovery/validate`: check if a model ID is known + suggest alternatives

**MCP Server (Task 1.9)**
- `src/mcp/zmlr-server.js`: Model Context Protocol server exposing `list_models`, `recommend_model`, `validate_model`
- Handlers tested with 139-test unit suite

**Unit Test Suite — 139 tests**
- `tests/unit/smartRouter.test.js`: intent inference, constraint parsing, enrichResponse, RoutingMetrics
- `tests/unit/mcpServer.test.js`: all 3 MCP handlers, filter/edge cases
- `tests/unit/discoveryService.test.js`: catalog, capability detection, recommendations, validation
- `tests/unit/discoveryService.test.js`, `providerCredentials.test.js`, `tokenRefresh.test.js`, `formatTranslation.test.js`

---

## v0.3.2-alpha (2026-03-16)

### Connection Resilience & Self-Healing
- **Background token refresh:** New `TokenRefreshJob` runs every 20 minutes via `MaintenanceScheduler`, proactively refreshing OAuth tokens before they expire. Standard OAuth tokens are refreshed when within 2 hours of expiry; GitHub Copilot tokens (28-min lifespan) are refreshed within 25 minutes. A concurrent-refresh guard prevents duplicate refreshes if a sweep runs long.
- **`needs_reauth` state:** When a background refresh fails after all attempts, the connection is marked `needs_reauth` rather than silently failing. The provider test endpoint (`POST /api/providers/[id]/test`) now also sets `needs_reauth` on 401/403 for OAuth connections instead of the generic "error" state.
- **New API endpoints:**
  - `GET /api/providers/health` — returns `{ total, active, expiringSoon, needsReauth, rateLimited, unavailable, connections[] }` for dashboard widgets and monitoring
  - `POST /api/providers/[id]/reauth` — resets `needs_reauth` → `pending` and returns `{ provider, authType }` so the UI knows which OAuth flow to re-trigger

### Provider UX Overhaul
- **Connection health indicators:** Provider cards now show colored status dots (green/yellow/red/gray), token expiry countdowns ("Expires in 1h 30m" / "Expired 20m ago"), rate-limit timestamps, and a prominent "Reconnect" button when a connection needs re-authentication.
- **Global health banner:** Top of providers page shows "X of Y connections active" with a warning if any need attention.
- **OAuth modal improvements:** Step progress bar shows current phase ("Opening browser...", "Exchanging code for tokens...", etc.). Client-secret input now includes contextual help explaining it's an app-level credential (same for all ZMLR deployments). Error messages are displayed in a styled callout rather than bare red text.

### Setup & Onboarding
- **4-step setup wizard:** Rewrote first-run setup page with guided steps: set password → connect a provider (with quick-connect cards for Kilo.ai/GitHub Copilot/Antigravity) → test your endpoint (live curl runner with copy button) → done.
- **Empty state guidance:** Providers page now shows styled quick-connect cards when no providers are connected. Dashboard overview shows a "Get Started" card for new installs and a "connections need attention" alert when all connections are broken.

### Configuration & Deployment
- **`.env.example` updated:** Now documents `ANTIGRAVITY_CLIENT_SECRET`, `GEMINI_CLIENT_SECRET`, and `IFLOW_CLIENT_SECRET` as required app-level OAuth credentials (same for all deployers, distinct from per-user tokens).
- **`npm run check-env`:** New script (`scripts/check-env.js`) validates that OAuth app secrets are set for any active provider connections. Exits with code 1 when secrets are missing, with actionable fix instructions. Safe to run in CI.

### Testing
- **Unit test suite:** 89 tests across 4 files covering token refresh logic, account fallback/cooldown, provider credential selection (fill-first + round-robin), and request/response format translation (OpenAI ↔ Claude ↔ Gemini). Run with `npm run test:unit`.

---

## v0.3.0-alpha (2026-03-13)

### Prebuilt: no .env required (bootstrap / Phase 1)
- **Bootstrap secrets:** Prebuilt zip can run without a `.env` file. First run: `node store-bootstrap.cjs` to set dashboard password (and optional port); secrets are stored in app data dir (`bootstrap.secret`, mode 0600). Then start with `node run.js`, which loads bootstrap into `process.env` before starting the server.
- **Scripts:** `scripts/bootstrapEnv.cjs` (get/set/inject), `scripts/run-with-bootstrap.js` (copied to standalone as `run.js`), `scripts/store-bootstrap.cjs` (one-time CLI). All copied into standalone by `prepare-standalone.cjs`.
- **Docs:** STANDALONE_README and zippymesh-dist README now lead with the no-.env flow; `.env` remains optional for power users (`node server.js`).

---

## v0.2.7-alpha (2026-03-11)

### Structured Observability & Error Contracts (Phase 6)
- Correlation IDs: requestId generated or taken from `X-Request-ID`, threaded through chat orchestration, logging, and API error responses; included in `X-Request-ID` response header and `error.request_id` in JSON.
- Centralized API error contract: `apiError()` and `errorResponse()` with stable `{ error: { message, type, code, request_id? } }`; all major API routes refactored to use it.
- Provider lifecycle events: `emitProviderLifecycleEvent()` for connect/refresh/fail/recover/sync; events logged and appended to `provider-lifecycle-events.jsonl` in data dir (redacted).
- Request logger: session folders and structured log files include requestId; sensitive values fully redacted as `***`.

### Retry, Circuit Breaker & Background Sync (Phase 7)
- Bounded retries: transient failures (5xx, 429, 408) retry same candidate up to 2 times with exponential-backoff + jitter before failover.
- Circuit breaker: per-provider state (closed → open after 5 failures, 60s cooldown, halfOpen probe); open providers excluded from candidate list; success/failure recorded in orchestrator (sequential and batch).
- Single-flight + jitter: one catalog sync at a time; auto sync applies 0–30s jitter before starting to spread load.

### Login, ZippyNode & Pool Table (post–Phase 7)
- Login: trim password and `INITIAL_PASSWORD`; recovery path so `INITIAL_PASSWORD` from env is accepted when stored hash compare fails (avoids lockout after env/hash mismatch). Settings password-change flow uses trimmed comparison for env fallback.
- ZippyNode toggle: extended health-check wait (25 retries × 1.5s, 3s per-request timeout); status bar shows parsed error message and sets `nodeError` instead of dumping raw JSON to console.
- Global Account Pool: optional columns Errors (24h), Uptime %, Avg latency (24h); uptime derived from usage history success rate; pool stats API returns `errors24h`, `uptimePct`, `avgLatencyMs24h`. Responsive table (smaller padding/text on small screens, horizontal scroll, min-w-0 for truncation).

---

## v0.2.6-alpha (2026-03-11)

### Routing Registry Migration
- Updated routing suggestion and v1 model listing paths to use lifecycle-aware provider model registry state.
- Model suggestions now filter out deprecated registry entries while preserving provider fallback behavior for unknown/no-registry models.
- `/v1/models` now prefers live registry-backed models for provider/model listings and falls back to static definitions only when registry data is unavailable.
- Added lifecycle-aware filtering to routing playbook generation metadata lookups to avoid proposing unavailable registered models.

---

## v0.2.5-alpha (2026-03-11)

### Model Lifecycle Registry
- Added lifecycle schema fields to `model_registry` (`firstSeenAt`, `lastSeenAt`, `missingSinceAt`, `lifecycleState`, `replacementMetadata`) with runtime-safe SQLite migrations.
- Added per-provider lifecycle reconciliation during provider catalog sync: reactivated models now return to `active`, absent models transition to `missing`, then `deprecated` on repeated absence.
- Added persistent provider catalog sync health tracking in settings (`providerCatalogSyncHealth`) including consecutive-failure and last-attempt metrics for operational stability.
- Updated deprecated-model discovery to prioritize registry lifecycle state before fallback live provider queries.

---

## v0.2.4-alpha (2026-03-11)

### Provider Capability Registry
- Added a shared OAuth capability registry to remove scattered provider-branching logic across UI/API/token refresh flow.
- Centralized OAuth flow decisions for device-code polling, manual callback handling, and code-verifier requirements.
- Routed token refresh through provider capability-based dispatch maps to reduce duplicated branching.
- Kept OAuth client-secret support durable for antigravity, gemini-cli, and iflow with encrypted persisted storage.

---

## v0.2.3-alpha (2026-03-11)

### Data-at-Rest Security
- Stored OAuth client secrets in user data directory are now encrypted at rest by default.
- Added compatibility migration from legacy plaintext `oauth-secrets.json` entries to encrypted envelopes.
- Added `ZIPPY_OAUTH_SECRET_KEY` support for deterministic machine-level secret encryption keys.
- Added migration path from DB-persisted metadata secrets into encrypted user data storage during OAuth resolution.

---

## v0.2.2-alpha (2026-03-11)

### Security & Persistence
- Completed full OAuth-secret persistence and UI-first recovery path for providers requiring client secrets (antigravity, gemini-cli, iflow).
- Added provider security contract coverage for redaction behavior and sensitive log masking.
- Bumped release metadata so dashboards and profile reporting reflect the current safety hardening release.

---

## v0.2.1-alpha (2026-03-11)

### Security & Data Isolation
- OAuth provider metadata is now sanitized before being returned to dashboard APIs; nested secret fields are redacted.
- Added explicit connection flags (`hasOAuthClientSecret`, `oauthNeedsSecret`, `hasRefreshToken`, `tokenExpired`) so UI can show state without exposing credentials.

### OAuth Persistence & Reliability
- OAuth secret resolution now prioritizes user-provisioned data (request + connection metadata) before env fallback.
- Added DB-backed secret continuity across rebuilds for OAuth flows that require client secrets.
- Extended secret-required onboarding support to `iflow` in addition to `antigravity` and `gemini-cli`.

### UX Indicators
- Providers dashboard cards now surface a warning badge when connections are missing required OAuth secrets.
- Connection cards now show `secret configured` / `secret missing` badges for OAuth accounts.

---

# v0.2.0-alpha (2026-03-01)

## Features
- Trust score and ServiceRegistry integration (optional)
- Plugin architecture (manifest, nav, routes); LLM default plugin; stub dVPN/compute
- Docker and sidecar port alignment (9480)
- .env.example: JWT_SECRET, INITIAL_PASSWORD, DATA_DIR

## Security
- Removed hardcoded credentials; use INITIAL_PASSWORD from env only
- NOTICE.md and SECURITY.md added

## Fixes
- docker-compose: SIDE_CAR_URL and sidecar ports aligned to 9480
- sidecar Dockerfile: correct binary name (zippy-mesh-sidecar)
- Settings sync: use SIDE_CAR_URL for node pricing

---

# v0.2.27 (2026-01-15)

## Features
- Added Kiro Provider with generous free quota

## Bug Fixes
- Fixed Codex Provider bugs

# v0.2.21 (2026-01-12)

## Changes
- Update ReadMe
- Fix bug **antigravity**

