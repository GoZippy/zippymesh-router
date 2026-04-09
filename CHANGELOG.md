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

