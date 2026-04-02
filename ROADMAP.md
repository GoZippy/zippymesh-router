# ZippyMesh LLM Router (ZMLR) — Project Roadmap

**Last Updated:** 2026-03-18
**Current Version:** 1.0.0
**Document Status:** Living document — update when milestones are completed or plans change.

This roadmap was derived from a 5-agent parallel analysis of the codebase and is written for long-term reference by developers, AI agents, and the project owner. Any engineer or AI agent should be able to pick up any task and execute it with the context given here.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Release Architecture & Open Source Strategy](#2-release-architecture--open-source-strategy)
3. [Milestones Summary](#3-milestones-summary)
4. [Detailed Task List](#4-detailed-task-list)
   - [Milestone 1: v0.4 — Production Credibility](#milestone-1-v04--production-credibility)
   - [Milestone 2: v0.5 — Feature Parity](#milestone-2-v05--feature-parity-with-competitors)
   - [Milestone 3: v0.6 — Unique Differentiation](#milestone-3-v06--unique-differentiation)
   - [Milestone 4: v0.7 — Open Source Launch](#milestone-4-v07--open-source-launch)
   - [Milestone 5: v1.0 — Enterprise Ready](#milestone-5-v10--enterprise-ready)
5. [Chain ID Selection](#5-chain-id-selection)
6. [Open Questions & Decisions Needed](#6-open-questions--decisions-needed)
7. [Upgrade Path](#7-upgrade-path)

---

## 1. Project Overview

ZMLR is a locally-deployed, full-stack AI routing gateway built in Next.js/Node.js with Tauri for desktop packaging. It sits between client tools (Cursor, Kilo Code, OpenClaw, any OpenAI-compatible app) and upstream AI providers, adding smart routing, caching, failover, and cost control — all running on the user's machine with no cloud dependency.

### Core Capabilities

| Capability | Implementation |
|---|---|
| OpenAI-compatible API | `/v1/chat/completions` endpoint (`src/app/api/v1/chat/completions/route.js`) |
| Smart Router | NLP intent detection + header-driven routing (`src/lib/routing/smartRouter.js`) |
| Routing Headers | `X-Intent`, `X-Max-Latency-Ms`, `X-Prefer-Free`, `X-Prefer-Local`, etc. |
| Playbook Engine | Named rulesets with boost/filter/sort rules scored per intent (`src/lib/routing/engine.js`) |
| Multi-layer Failover | Same model → equivalent → free tier → local (Ollama/LMStudio) → ZippyMesh P2P (`src/lib/routing/failoverManager.js`) |
| P2P Mesh Networking | UDP beacon discovery on port 20129 (`src/lib/discovery/p2pDiscovery.js`) |
| Trust Scores | Per-peer trust scoring system (`src/lib/trustScore.js`) |
| ZippyCoin Wallet | EVM-compatible wallet on chain ID 947 (ZIP) (`src/lib/zippycoin-wallet.js`) |
| MCP Server | Exposes ZMLR tools to AI agents (OpenClaw, Kilo Code) |
| Session Routing | Session-aware routing + persistent routing memory per client (`src/lib/routing/sessionContext.js`, `src/lib/routingMemory.js`) |
| Desktop App | Tauri packaging for Windows/Mac/Linux (`src-tauri/`) |

### Key Architectural Files

```
src/lib/routing/
  smartRouter.js        — Main routing orchestrator
  engine.js             — Playbook scoring and execution engine
  intentDetector.js     — NLP intent classification
  failoverManager.js    — Multi-layer fallover logic
  sessionContext.js     — Per-session routing state
  rateLimiter.js        — Rate limit enforcement
  queueManager.js       — Request queuing

src/lib/
  localDb.js            — SQLite database (better-sqlite3, sync API)
  routingMemory.js      — Persistent routing decisions per client
  trustScore.js         — P2P peer trust scoring
  zippycoin-wallet.js   — EVM wallet (chain ID 947)
  circuitBreaker.js     — Per-provider circuit breaker
  retryPolicy.js        — Transient error retry with backoff

src/lib/discovery/
  localDiscovery.js     — Ollama/LMStudio local model discovery
  p2pDiscovery.js       — UDP P2P beacon discovery
  catalogService.js     — Model catalog aggregation
  recommendationService.js — Model recommendation logic
```

---

## 2. Release Architecture & Open Source Strategy

ZMLR is distributed as a compiled application. The project has both proprietary and open-sourceable components with a clear split strategy.

### 2.1 Open Source Components (Community Edition — Public Repo)

These components are safe and valuable to share with the community:

- Core routing engine: `src/lib/routing/` (minus scoring weights)
- Playbook schema and execution logic
- Provider connector interfaces
- MCP server definition
- Dashboard UI components
- API route skeletons
- Documentation and examples
- Setup wizard and onboarding flow
- Virtual key management (see open question in Section 6)
- Prompt cache and semantic cache
- Guardrails engine and default patterns
- Request tracing and analytics UI

### 2.2 Proprietary Components (Private Repo Only)

These components remain private and are replaced with interface stubs in community builds:

- P2P mesh networking: `src/lib/discovery/p2pDiscovery.js`, beacon/discovery internals
- ZippyCoin wallet integration: `src/lib/zippycoin-wallet.js`
- Trust scoring system: `src/lib/trustScore.js`
- Routing memory ML models (when built, Task 3.6)
- ZippyCoin chain node implementation
- Marketplace and monetization backend logic
- Dashboard pages: `wallet/`, `monetization/`, parts of `network/`

### 2.3 Release Build Strategy

The community edition is produced by a build script that replaces proprietary files with stubs before the public repo receives the commit.

- **Public GitHub repo:** "community edition" — proprietary modules replaced by interface stubs
- **Build script:** `scripts/build-community.sh` (Task 4.1) strips/replaces proprietary files before release
- **Version sync:** public repo tracks the same semver as the private repo
- **Marker files:** `.zippy-private` files identify files to exclude from public release
- **Stubs:** export the same interface as the real implementation but return `{ error: "This feature requires ZippyMesh Pro" }`

### 2.4 Upgrade Path for Existing Installs

Schema changes must always be backward-compatible within a minor version series. The following patterns are established and must be followed:

- **SQLite migrations:** `getSqliteDb()` in `localDb.js` uses `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN` via the `ensureColumn()` helper. Never drop or rename columns in patch releases.
- **lowdb JSON migrations:** `version` field in `db.json`; migration scripts live in `scripts/migrate/`
- **Settings migrations:** New keys in `INITIAL_SETTINGS` get auto-merged on first load; user values win
- **Breaking changes:** Documented in `CHANGELOG.md` with exact migration commands
- **Auto-upgrade:** Check current schema version on startup, run pending migrations in order
- **Rollback:** Migrations must be reversible; take a backup of `db.json` before running any migration

---

## 3. Milestones Summary

| Milestone | Version | Theme | Scope |
|---|---|---|---|
| 1 | v0.4 | Production Credibility | Critical bugs, observability, prompt cache, playbook simulation, developer quick-start |
| 2 | v0.5 | Feature Parity | Expert mode UI, virtual keys, integration guides, PII guardrails, OpenRouter meta-provider |
| 3 | v0.6 | Unique Differentiation | Semantic cache, routing memory ML, ZippyCoin billing, prompt library, log export |
| 4 | v0.7 | Open Source Launch | Community edition repo, plugin architecture, documentation site, API stability |
| 5 | v1.0 | Enterprise Ready | Multi-tenancy, compliance (HIPAA/SOC2 path), SLA monitoring, community marketplace |

---

## 4. Detailed Task List

Each task includes the affected files, a precise description, numbered implementation steps, architectural context, and acceptance criteria.

---

## Milestone 1: v0.4 — Production Credibility

**Goal:** Fix remaining critical issues, make every request observable, add developer-facing tooling that builds trust in the router's decisions.

---

### Task 1.1: Fix Critical Bugs

**Status:** Completed

- [x] Fix missing `await` on `response.json()` in `src/lib/routing/smartRouter.js:273`
- [x] Replace hardcoded `"zippymesh-api-key-secret"` with ephemeral fallback + warning in `src/lib/auth/apiKey.js:3`
- [x] Update chain ID 777 → 947 (ZIP) comment in `src/lib/zippycoin-wallet.js:6`

---

### Task 1.2: Per-Request Trace Logging

**Files:**
- `src/lib/localDb.js`
- `src/app/api/v1/chat/completions/route.js`
- `src/app/(dashboard)/dashboard/analytics/page.js`
- `src/app/api/routing/traces/route.js` (new)

**What to do:** Capture a detailed trace record for every routed request. Store in SQLite. Surface in the Analytics tab as a filterable, paginated request history table with expandable row detail.

**Subtasks:**

1. Add `request_traces` table to the `getSqliteDb()` exec block in `localDb.js`:

   ```sql
   CREATE TABLE IF NOT EXISTS request_traces (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     trace_id TEXT NOT NULL,
     timestamp TEXT NOT NULL,
     intent TEXT,
     detected_intent_confidence REAL,
     playbook_used TEXT,
     selected_model TEXT,
     used_model TEXT,
     provider TEXT,
     ttft_ms INTEGER,
     total_latency_ms INTEGER,
     tokens_in INTEGER DEFAULT 0,
     tokens_out INTEGER DEFAULT 0,
     cost_estimate REAL DEFAULT 0,
     fallback_depth INTEGER DEFAULT 0,
     success INTEGER DEFAULT 0,
     error_message TEXT,
     session_id TEXT,
     client_id TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON request_traces(timestamp);
   CREATE INDEX IF NOT EXISTS idx_traces_intent ON request_traces(intent);
   ```

2. Add `saveRequestTrace(trace)` and `getRequestTraces({ hours, intent, model, limit, offset })` sync functions to `localDb.js`. Use the existing better-sqlite3 sync pattern already established in that file.

3. In `src/app/api/v1/chat/completions/route.js`, after execution completes (success or failure), build and save a trace object with all available fields including fallback depth and final used model.

4. Create `GET /api/routing/traces` endpoint at `src/app/api/routing/traces/route.js` with query params: `hours` (default 24), `intent` (filter), `model` (filter), `success` (0/1 filter), `limit` (default 50), `offset` (pagination).

5. Add "Request History" tab to the Analytics page with a paginated table. Columns: Time, Intent, Model, Provider, Latency (ms), Cost ($), Status (success/fail/fallback).

6. Add expandable row detail showing all captured trace fields: trace ID, confidence, playbook used, TTFT, token counts, fallback depth, error message if any.

7. Add "Export CSV" button that downloads current filtered results as a CSV file.

**Context:** `localDb.js` uses `better-sqlite3` with synchronous calls. All DB interactions in that file are sync. The chat completions route is Next.js App Router. Trace saving must be non-blocking from the response path — save after the streaming response has been initiated or use `after()` if available in the Next.js version in use.

**Acceptance criteria:** After making 3 requests through `/v1/chat/completions`, Analytics → Request History shows all 3 entries with correct model, latency, and success/fail status.

---

### Task 1.3: Exact-Match Prompt Cache

**Files:**
- `src/lib/localDb.js`
- `src/lib/promptCache.js` (new)
- `src/app/api/v1/chat/completions/route.js`
- Settings page (wherever cache settings are surfaced in the dashboard)

**What to do:** SHA-256 hash the normalized messages array, check SQLite cache before forwarding to any provider, return the cached response on hit. Cache is keyed on `(hash, model)`. TTL is configurable per install. Streaming requests are not cached.

**Subtasks:**

1. Add `prompt_cache` table to SQLite in `localDb.js`:

   ```sql
   CREATE TABLE IF NOT EXISTS prompt_cache (
     hash TEXT NOT NULL,
     model TEXT NOT NULL,
     response_json TEXT NOT NULL,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     hit_count INTEGER DEFAULT 0,
     PRIMARY KEY (hash, model)
   );
   ```

2. Create `src/lib/promptCache.js` with the following exports:
   - `hashMessages(messages)` — SHA-256 of `JSON.stringify(messages)` after normalizing whitespace in content strings
   - `getCachedResponse(hash, model)` — sync lookup; returns null if not found or expired; increments `hit_count` on hit
   - `setCachedResponse(hash, model, responseJson, ttlSeconds)` — sync upsert with `ON CONFLICT(hash, model) DO UPDATE`
   - `getCacheStats()` — returns `{ totalEntries, hitRate7d, sizeEstimateKb }`
   - `clearExpired()` — deletes all rows where `expires_at < datetime('now')`; call this on startup

3. In the chat completions route, before forwarding to provider:
   - If `body.stream === true`, skip the cache entirely (streaming responses cannot be replayed)
   - Call `hashMessages(body.messages)`, then `getCachedResponse(hash, body.model)`
   - On hit: return HTTP 200 with the cached response JSON and add `X-Cache: HIT` response header
   - On miss: proceed with routing; after a successful non-streaming provider response, call `setCachedResponse` with TTL from settings (default: 3600 seconds)

4. Add cache settings section to the user-facing settings page:
   - Enable/disable toggle (`promptCacheEnabled`, default: `true`)
   - TTL slider (range: 60 seconds to 604800 seconds / 7 days; display in human-readable units)
   - "Clear Cache Now" button that calls `clearExpired()` then a full clear
   - Stats display: hit rate, entry count, estimated size

5. Record cache hit/miss in the request trace (Task 1.2 field: `cache_hit`).

**Context:** `hashMessages` must normalize whitespace in message content to prevent cache misses from cosmetic differences. Use Node.js built-in `crypto.createHash('sha256')` — no new dependencies needed.

**Acceptance criteria:** Sending identical non-streaming messages twice results in the second response having `X-Cache: HIT` in the response headers and a measurably shorter latency shown in request traces.

---

### Task 1.4: Playbook Simulation / Dry-Run Endpoint

**Files:**
- `src/app/api/routing/playbooks/test/route.js` (new)
- `src/lib/routing/engine.js`
- `src/app/(dashboard)/dashboard/routing/page.js`

**What to do:** Add a dry-run endpoint that runs the full routing selection logic without executing the actual LLM request. Returns the model that would be selected, the scoring breakdown, and the complete fallback chain. Add a "Simulate" button to the playbook builder UI.

**Subtasks:**

1. Create `POST /api/routing/playbooks/test` endpoint. Request body:

   ```json
   {
     "playbookId": "optional — if omitted, uses best matching playbook",
     "intent": "code | chat | reasoning | vision | embedding | fast | default",
     "constraints": {
       "maxLatencyMs": 2000,
       "maxCostPerMTokens": 0.5,
       "preferFree": false,
       "preferLocal": false
     },
     "messages": [{ "role": "user", "content": "optional test message for intent auto-detection" }]
   }
   ```

2. In the handler, invoke the routing engine with a `dryRun: true` flag that skips the actual provider call and returns the selection metadata.

3. Response shape:

   ```json
   {
     "matched": true,
     "selectedModel": "claude-3-5-sonnet",
     "provider": "anthropic",
     "score": 142,
     "scoreBreakdown": [
       { "factor": "intent_match", "points": 50, "reason": "Playbook targets 'code' intent" },
       { "factor": "boost_rule", "points": 30, "reason": "Rule: boost claude-3-5-sonnet for code" }
     ],
     "fallbackChain": [
       { "model": "claude-3-5-sonnet", "provider": "anthropic", "score": 142 },
       { "model": "gpt-4o", "provider": "openai", "score": 98 }
     ],
     "appliedRules": ["boost:claude-3-5-sonnet", "filter-out:slow-models"],
     "estimatedCostPer1kTokens": 0.003,
     "estimatedLatencyMs": 800
   }
   ```

4. If the routing engine does not currently support dry-run natively, refactor `selectPlaybook()` and the scoring logic in `engine.js` into a pure function that accepts catalog + playbooks as parameters and returns the selection without any side effects or provider calls.

5. Add "Simulate" button to the Routing Playbooks tab in the dashboard. Opens a modal with:
   - Intent dropdown (code / chat / reasoning / vision / embedding / fast / default)
   - Optional: text area to paste a test message (auto-detects intent if intent not manually set)
   - "Run Simulation" button — calls the test endpoint
   - Results panel: selected model with score, full score breakdown table, collapsible fallback chain list

6. Add "Test before saving" CTA to the playbook creation/edit flow — runs simulation with current draft rules before persisting.

**Context:** The scoring engine in `engine.js` must remain the authoritative path for both real and simulated routing to ensure simulation results are accurate. Do not implement a parallel scoring path.

**Acceptance criteria:** `POST /api/routing/playbooks/test` with `{ "intent": "code" }` returns a valid JSON object with a non-null `selectedModel` and a `fallbackChain` array with at least one entry.

---

### Task 1.5: Playbook Template Gallery in UI

**Files:**
- `src/app/(dashboard)/dashboard/routing/page.js`
- `src/app/(dashboard)/dashboard/routing/components/TemplateGallery.js` (new)

**What to do:** The 18 `SMART_PLAYBOOK_TEMPLATES` already exist in constants and `POST /api/routing/playbooks/templates` already handles instantiation. This task is purely a UI layer over existing backend functionality.

**Subtasks:**

1. Add a "From Template" button to the playbook creation modal in `routing/page.js`. This button opens the `TemplateGallery` component instead of the blank creation form.

2. Create `TemplateGallery.js` component:
   - Grid of template cards, each showing: name, description, intent tags (pills), rule count
   - Filter bar with category buttons: All / Code / Cost / Speed / Privacy / Local
   - "Preview" button on each card: expands to show the full rule list before creating
   - "Use This Template" button: calls `POST /api/routing/playbooks/templates` then closes gallery and shows the new playbook

3. Fetch available templates from `GET /api/routing/playbooks/templates` on component mount. Show loading skeleton during fetch.

4. Show a success toast notification with a link to the newly created playbook after instantiation.

5. Add a "Restore Defaults" button somewhere accessible in the routing page to restore the 15 built-in `SMART_PLAYBOOKS` if they have been deleted.

**Context:** The backend for this is complete. Zero new API routes needed. Focus is entirely on the React component layer and UX polish.

**Acceptance criteria:** User can click "From Template", see a gallery of named templates with descriptions and intent tags, and create a new playbook from any template in 2 clicks.

---

### Task 1.6: Developer Quick-Start Page

**Files:**
- `src/app/(dashboard)/dashboard/quickstart/page.js` (new)
- Sidebar navigation component (add "Integration Guide" entry)
- `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` (add quick-link)

**What to do:** A dedicated page with copy-paste integration examples for every major SDK and tool. The page auto-injects the user's current server URL and API key so examples are immediately runnable.

**Subtasks:**

1. Create the page at route `/dashboard/quickstart` with tabbed sections:
   - **Python:** `openai` SDK, `litellm`, `langchain`
   - **JavaScript/TypeScript:** `openai` SDK, Vercel AI SDK
   - **cURL:** basic completion, streaming, with headers
   - **Cursor IDE:** `settings.json` config snippet
   - **Any OpenAI-compatible tool:** generic base URL + key instructions

2. Each code example must auto-inject the user's current endpoint URL (from settings or `window.location` origin + port) and API key (masked: show first 8 chars + `...`). Pull these from the existing settings/auth context.

3. Add a clipboard copy button to every code block. Use the browser `navigator.clipboard` API with a visual "Copied!" confirmation.

4. Add a "Test Connection" button that fires a real minimal request (`/v1/models`) and shows the raw JSON response or an error message inline.

5. Add a prominent link to this page from the Endpoint/API Server page.

6. Add "Integration Guide" entry to the sidebar navigation, positioned near the Endpoint entry.

**Context:** The server URL and API key are available from existing settings state. Do not hardcode any URLs. The page must work regardless of the port the user is running ZMLR on.

**Acceptance criteria:** The page shows at least 3 complete, copy-paste-ready code examples with the current server URL pre-filled correctly.

---

### Task 1.7: X-Headers Documentation on Endpoint Page

**Files:**
- `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`

**What to do:** Add a collapsible "Smart Routing Headers" section below the endpoint URL display, documenting all supported request headers and the response headers ZMLR injects.

**Subtasks:**

1. Add a collapsible accordion component below the endpoint URL and API key display.

2. Inside the accordion, render a table with columns: **Header Name** | **Direction** | **Purpose** | **Example Value** | **Notes**

3. Document the following headers:

   | Header | Direction | Purpose | Example |
   |---|---|---|---|
   | `X-Intent` | Request | Hint the router about request type | `code`, `chat`, `reasoning`, `vision`, `embedding`, `fast`, `default` |
   | `X-Max-Latency-Ms` | Request | Maximum acceptable response latency | `2000` |
   | `X-Max-Cost-Per-M-Tokens` | Request | Maximum cost per million tokens (USD) | `0.50` |
   | `X-Min-Context-Window` | Request | Minimum context window required (tokens) | `32000` |
   | `X-Prefer-Free` | Request | Prefer free-tier models | `true` |
   | `X-Prefer-Local` | Request | Prefer local (Ollama/LMStudio) models | `true` |
   | `X-Selected-Model` | Response | Model the router selected | `claude-3-5-sonnet` |
   | `X-Routing-Intent` | Response | Intent the router detected or used | `code` |
   | `X-Routing-Score` | Response | Numeric score of selected model | `142` |
   | `X-Routing-Reason` | Response | Human-readable reason for selection | `Playbook boost matched intent` |

4. Add a "See full integration guide" link at the bottom of the accordion pointing to the Quick-Start page (Task 1.6).

**Acceptance criteria:** The Endpoint page has a collapsible section labeled "Smart Routing Headers" that expands to show all 10 headers in a clean table with descriptions.

---

## Milestone 2: v0.5 — Feature Parity with Competitors

**Status:** Completed

**Goal:** Close the UX gap between ZMLR and commercial offerings like LiteLLM, OpenRouter, and PortKey. Add the features users expect before recommending ZMLR to others.

---

### Task 2.1: Expert / Developer Mode Toggle

**Files:**
- `src/shared/hooks/useExpertMode.js` (new)
- Sidebar navigation component (`src/shared/components/Sidebar.js` or equivalent)
- `src/app/(dashboard)/layout.js`
- Multiple page files (read-only guard additions)

**What to do:** Add a Basic/Expert mode toggle persisted in `localStorage`. In Basic mode, hide advanced features that would confuse non-technical users. In Expert mode, reveal all features plus new expert-only tools.

**Subtasks:**

1. Create `useExpertMode()` hook backed by `localStorage` key `zmlr_expert_mode`. Returns `{ isExpert, setExpert, toggle }`.

2. Add a toggle control to the sidebar footer or header area. Style as a labeled switch: "Basic" / "Expert". Add a "What is Expert Mode?" tooltip explaining it reveals advanced networking, wallet, and developer tools.

3. Wrap the following sidebar items with `{isExpert && ...}`:
   - Wallet / ZippyCoin
   - Monetization
   - Network / Mesh
   - Compute / dVPN
   - CLI Tools
   - Routing History (new, Task 3.1)
   - Cost Simulator (new, Task 3.2)
   - Request Tracer (new, Task 3.1)

4. Create an `ExpertGate` component: when a user navigates directly to an expert-only route in basic mode, show an overlay with "Enable Expert Mode to access this feature" and a toggle button. Do not redirect — let them choose.

5. Default state is **Basic mode** for all fresh installs.

**Context:** This is a display-only feature. No backend changes needed. All data is still accessible in basic mode via direct API calls — the toggle only controls sidebar visibility and page access gates.

**Acceptance criteria:** Default state shows a streamlined sidebar without wallet/network/compute items. Toggling to Expert mode reveals all items and allows navigation to advanced pages.

---

### Task 2.2: Rename Confusing UI Terminology

**Files:**
- `src/shared/constants/displayNames.js` (new)
- All dashboard page files (display labels only)
- Sidebar navigation component

**What to do:** Systematic rename of confusing technical terms in the UI to plain-English equivalents. Backend API routes, database column names, prop names, and internal code identifiers do not change.

**Rename map:**

| Internal Term | User-Facing Display Label |
|---|---|
| Pools | Provider Groups |
| Combos | Fallback Chains |
| Playbooks | Routing Rules |
| Intent (analytics/UI labels) | Request Type |
| Sidecar (error messages) | Local Service |
| Endpoint (sidebar label) | API Server |
| Fallback (status messages) | Backup |

**Subtasks:**

1. Create `src/shared/constants/displayNames.js` as a single source of truth:

   ```js
   export const DISPLAY_NAMES = {
     pools: 'Provider Groups',
     combos: 'Fallback Chains',
     playbooks: 'Routing Rules',
     intent: 'Request Type',
     sidecar: 'Local Service',
     endpoint: 'API Server',
     fallback: 'Backup',
   };
   ```

2. Update the sidebar navigation labels to use `DISPLAY_NAMES` values.

3. Update page `<h1>` titles, page descriptions, and section headings.

4. Update empty state messages and toast notifications.

5. Update tooltip and help text strings.

6. **Do not change:** API route paths, database columns, React prop names, internal function names, or any code that is not a user-facing display string.

**Acceptance criteria:** A search for the string `"Pools"` in user-facing display strings (page titles, sidebar labels, descriptions) returns zero results. API routes like `/api/routing/pools` remain unchanged.

---

### Task 2.3: Virtual API Key Management

**Files:**
- `src/lib/localDb.js`
- `src/app/api/keys/route.js` (new)
- `src/app/api/keys/[id]/route.js` (new)
- `src/app/(dashboard)/dashboard/keys/page.js` (new, or add to profile page)
- `src/lib/auth/middleware.js`

**What to do:** Multi-key system where each key maps to a named entity (team, project, app) with per-key budgets and rate limits. Enables shared installs with per-consumer cost tracking.

**Subtasks:**

1. Add `virtual_keys` table to SQLite in `localDb.js`:

   ```sql
   CREATE TABLE IF NOT EXISTS virtual_keys (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     key_hash TEXT NOT NULL UNIQUE,
     key_prefix TEXT NOT NULL,
     owner TEXT DEFAULT 'default',
     team TEXT,
     project TEXT,
     monthly_token_budget INTEGER,
     monthly_dollar_budget REAL,
     tokens_used_this_month INTEGER DEFAULT 0,
     dollars_used_this_month REAL DEFAULT 0.0,
     rate_limit_rpm INTEGER,
     allowed_providers TEXT,
     allowed_models TEXT,
     is_active INTEGER DEFAULT 1,
     created_at TEXT,
     last_used_at TEXT,
     expires_at TEXT
   );
   ```

   Column notes: `key_prefix` = first 8 chars of the plaintext key, shown in UI. `key_hash` = SHA-256 of the full key, used for lookup. The plaintext key is only returned once at creation time — never stored.

2. Add sync functions to `localDb.js`: `createVirtualKey(data)`, `getVirtualKeyByHash(keyHash)`, `listVirtualKeys()`, `revokeVirtualKey(id)`, `updateKeyUsage(id, { tokensUsed, dollarCost })`.

3. Create `GET /api/keys` (list all keys) and `POST /api/keys` (create key) at `src/app/api/keys/route.js`. Create `DELETE /api/keys/[id]` for revocation.

4. In `src/lib/auth/middleware.js`, when a request arrives with an `Authorization: Bearer <key>` header:
   - Hash the key and check `virtual_keys` table first
   - If found: enforce `is_active`, check `monthly_token_budget` and `monthly_dollar_budget`, check `rate_limit_rpm`, check `allowed_providers` and `allowed_models`
   - If budget exceeded: return 429 with `{ error: { message: "Monthly budget exceeded for this key", type: "budget_exceeded" } }`
   - If key not found in virtual_keys: fall through to existing master key check

5. Build the keys management UI page:
   - Table: Name, Key Prefix, Owner, Budget Usage (tokens and dollars), Rate Limit, Last Used, Status, Actions
   - Create form: name, owner, team, project, optional budget and rate limit fields
   - On creation: show the full key once in a modal with a "Copy and Close" button and a warning that it will not be shown again
   - Revoke button with confirmation dialog

6. Add monthly usage reset: on the first request of each calendar month per key, reset `tokens_used_this_month` and `dollars_used_this_month` to 0 (check `last_used_at` month vs current month to detect month boundary).

**Context:** Key hashing must use SHA-256 (same as available in Node.js `crypto` module). The `key_prefix` pattern (e.g., `zm_live_ab12cd34...`) should follow a recognizable format so users can identify ZMLR keys in their config files.

**Acceptance criteria:** Create two virtual keys with different monthly token budgets. Exhaust one key's budget via requests. Verify subsequent requests with that key return HTTP 429 with a message identifying the budget limit. Requests using the second key continue to succeed.

---

### Task 2.4: Setup Completion Checklist Widget

**Files:**
- `src/app/(dashboard)/dashboard/components/OverviewStats.js` (or dashboard overview page)
- `src/app/api/setup/status/route.js` (new)

**What to do:** Show a persistent setup progress widget on the main dashboard until the user has completed the core onboarding steps. Auto-dismiss when all steps are done.

**Setup steps to track:**

1. At least one provider connected with `status: active`
2. At least one fallback chain (combo) created
3. API key configured (the master key or at least one virtual key)
4. First successful routed request made (at least one trace in `request_traces` with `success = 1`)

**Subtasks:**

1. Create `GET /api/setup/status` that checks each condition against the database and returns:

   ```json
   {
     "steps": [
       { "id": "provider", "label": "Connect a provider", "done": true, "ctaPath": "/dashboard/providers" },
       { "id": "fallback_chain", "label": "Create a fallback chain", "done": false, "ctaPath": "/dashboard/routing" },
       { "id": "api_key", "label": "Set your API key", "done": false, "ctaPath": "/dashboard/settings" },
       { "id": "first_request", "label": "Make your first request", "done": false, "ctaPath": "/dashboard/quickstart" }
     ],
     "allDone": false,
     "completedCount": 1
   }
   ```

2. Add a `SetupChecklist` component to the dashboard overview page that:
   - Fetches `/api/setup/status` on mount
   - Shows a progress indicator (e.g., "1 of 4 complete")
   - Renders each step as a row with: status icon (checkmark or circle), description, and a CTA button if incomplete
   - Only renders when `allDone === false` and the user has not dismissed it

3. Track "dismissed" state in `localStorage` key `zmlr_setup_dismissed`. Add a dismiss ("×") button to the widget.

4. On `allDone === true`: show a brief celebration animation (confetti or similar), display a "You're all set!" toast notification, then auto-dismiss the widget after 3 seconds.

**Acceptance criteria:** A fresh install (no providers, no chains, no requests) shows the 4-step checklist. Each step disappears as its condition is met. The widget disappears entirely when all 4 steps are complete.

---

### Task 2.5: "Add to Routing Rules" Quick Actions

**Files:**
- `src/app/(dashboard)/dashboard/providers/page.js`
- Marketplace / model catalog pages
- `src/shared/components/AddToPlaybookModal.js` (new)

**What to do:** Add one-click "Add to Routing Rules" actions to provider list cards and model catalog entries so users can build routing rules without leaving their current page.

**Subtasks:**

1. Create a reusable `AddToPlaybookModal` component:
   - Radio choice: "Add to existing rule set" or "Create new rule set"
   - If existing: dropdown to select the playbook; radio for rule type (boost / filter-in)
   - If new: text input for name, intent dropdown, model is auto-added as the first boost rule
   - Submit button with loading state; success message with a link to the routing rules page on completion

2. Add an action button (or kebab menu item) to each provider connection card on the providers page.

3. Add an action button to model rows or cards in any model catalog / marketplace views.

4. Wire the modal's submit action to `PUT /api/routing/playbooks/[id]` to append the rule to an existing playbook, or `POST /api/routing/playbooks` to create a new one.

**Context:** The playbook API endpoints already exist. This is purely a UX convenience layer.

**Acceptance criteria:** From the providers page, a user can add a model to a routing ruleset in 3 clicks without navigating to the routing page.

---

### Task 2.6: Playbook Export / Import UI

**Files:**
- `src/app/api/routing/playbooks/[id]/export/route.js` (new)
- `src/app/(dashboard)/dashboard/routing/page.js`

**What to do:** Allow users to export playbooks as JSON files for backup, sharing, and version control. Import from JSON restores a playbook from file.

**Subtasks:**

1. Create `GET /api/routing/playbooks/[id]/export` that returns the full playbook object as `application/json` with header `Content-Disposition: attachment; filename="playbook-[name].json"`.

2. Add "Export JSON" button to each playbook card in the routing page. On click, trigger a file download.

3. Add "Duplicate" button that POSTs to the existing playbook creation endpoint with the same data but appends " (Copy)" to the name.

4. The `POST /api/playbooks/import` endpoint already handles import. Add an "Import from JSON" button to the routing page UI that:
   - Opens a file picker dialog (`<input type="file" accept=".json">`) or offers a "Paste JSON" text area alternative
   - Validates the JSON structure before sending
   - Shows the imported playbook name in a success toast

**Acceptance criteria:** Export a playbook to JSON, delete the original, re-import from the downloaded file, verify the playbook appears with identical rules.

---

### Task 2.7: PII Guardrails Default Patterns

**Files:**
- `src/lib/guardrails/` directory (explore first to understand current format)
- `src/shared/constants/defaults.js` (or equivalent defaults file)

**What to do:** Ship a comprehensive default guardrails configuration covering common PII patterns and basic prompt injection detection, enabled by default for privacy-focused playbooks.

**Subtasks:**

1. Explore `src/lib/guardrails/` to understand the current rule schema and execution interface before making any changes.

2. Define the following default patterns as a `GUARDRAILS_DEFAULTS` constant:
   - Email: `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b`
   - US Phone: `\b(\+1[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b`
   - SSN: `\b\d{3}-\d{2}-\d{4}\b`
   - Credit card: `\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b`
   - Prompt injection markers: `(?i)(ignore (previous|all) instructions|disregard your system prompt|you are now|your new instructions are|forget everything|act as if)`

3. On first install (when no guardrails are configured), seed with the defaults. Use the same "if empty, insert defaults" pattern already used for playbooks.

4. Privacy-strict playbooks auto-enable the PII ruleset. Add this to the Privacy playbook template.

5. Add a guardrails test utility to the simulation endpoint (Task 1.4) that can show which guardrails would fire for a given message.

**Context:** Redaction replaces matched content with `[REDACTED:type]` before the message reaches any provider. The guardrail check must happen after intent detection and playbook selection but before the provider call.

**Acceptance criteria:** With PII guardrails enabled, sending a request with a raw credit card number pattern in the message body results in `[REDACTED:credit_card]` reaching the provider, not the actual number.

---

### Task 2.8: OpenRouter as Meta-Provider

**Files:**
- `src/lib/providers/openrouter.js` (new)
- `src/lib/discovery/catalogService.js`
- `.env.example`
- Settings / provider add UI

**What to do:** Add OpenRouter as an optional upstream meta-provider. When connected, ZMLR gains access to 300+ models from OpenRouter's catalog while still applying local routing logic, playbooks, caching, and failover.

**Subtasks:**

1. Create `src/lib/providers/openrouter.js` implementing the standard ZMLR provider interface:
   - `listModels()` — fetch `https://openrouter.ai/api/v1/models`, return normalized model objects with prefix `openrouter/`
   - `chatCompletion(body)` — proxy to `https://openrouter.ai/api/v1/chat/completions`
   - `getHealth()` — check API key validity

2. OpenRouter is OpenAI-compatible so the implementation is lightweight. Key difference: the `Authorization` header uses the OpenRouter API key, and the `HTTP-Referer` and `X-Title` headers should be set (OpenRouter asks for these).

3. In `src/lib/discovery/catalogService.js`, when OpenRouter is configured and active, merge its model list into the local catalog with the `openrouter/` provider prefix.

4. Add `OPENROUTER_API_KEY=` to `.env.example` with a comment.

5. Add OpenRouter to the "Add Provider" UI with:
   - Provider logo / icon
   - Description: "Meta-provider giving access to 300+ models via a single API key"
   - Link to `https://openrouter.ai/keys` for key generation
   - API key input field

**Context:** OpenRouter's base URL is `https://openrouter.ai/api/v1`. The API is fully OpenAI-compatible. Model IDs from OpenRouter follow the pattern `provider/model-name` (e.g., `anthropic/claude-3-5-sonnet`). ZMLR should prefix these as `openrouter/anthropic/claude-3-5-sonnet` to avoid ID collisions.

**Acceptance criteria:** After adding a valid OpenRouter API key in the provider settings, the model catalog contains models with the `openrouter/` prefix, and those models can be selected in routing rules and used for completions.

---

## Milestone 3: v0.6 — Unique Differentiation

**Status:** Completed

**Goal:** Build features that cannot be found in other local LLM routers: routing intelligence learned from usage, semantic caching, ZippyCoin billing, and deep observability for developers.

---

### Task 3.1: Request Tracer UI (Expert Mode)

**Files:**
- `src/app/(dashboard)/dashboard/tracer/page.js` (new)
- `src/app/api/routing/traces/[id]/route.js` (new)
- `src/lib/routing/engine.js` (instrumentation additions)

**What to do:** A full step-by-step routing decision visualization for developers and operators. Shows each stage of the routing pipeline with timing, inputs, and outputs at each step.

**Subtasks:**

1. Enhance the trace storage schema (from Task 1.2) to capture per-step intermediate data:
   - Step list in a `steps_json` column: array of `{ step, durationMs, input, output, decision }`
   - Steps: `intent_detection`, `constraint_validation`, `catalog_query`, `candidate_scoring`, `playbook_application`, `failover_chain_build`, `provider_execution`

2. Instrument `engine.js` to record each step's entry/exit time and key data into a context object that gets serialized into `steps_json` on trace save. Use a lightweight approach that adds less than 1ms overhead per request.

3. Create the Tracer page at `/dashboard/tracer` (Expert mode only):
   - Left panel: list of recent requests (last 50), showing timestamp, intent, model, latency, status. Filterable by date range, intent, model, and success/fail.
   - Right panel: trace detail for the selected request

4. Trace detail layout (accordion or timeline):
   - Each pipeline step as an expandable row with: step name, duration, inputs, outputs, decisions made
   - Scoring breakdown section: each candidate model with per-factor score table (intent match, latency estimate, trust score, session history, playbook boost/penalty)
   - Final selection highlighted with reasoning

5. Add action buttons to trace detail:
   - "Repeat Request" — re-runs the exact request with the same parameters via the completions API
   - "Flag as Issue" — tags the trace with `flagged = 1` in the database for later investigation
   - "Copy Trace ID" — copies the UUID to clipboard for support/debugging

6. Add column filter: flagged traces can be filtered separately.

**Context:** Step instrumentation must be opt-in at the middleware level and must not affect production performance. Consider a `ZMLR_TRACE_STEPS=true` env flag to enable detailed step capture (default off in production builds, on in dev mode).

**Acceptance criteria:** Clicking on a trace shows a minimum of 5 pipeline steps with individual timing, and the candidate scoring section shows all considered models with their per-factor score breakdown.

---

### Task 3.2: Cost Simulator (Expert Mode)

**Files:**
- `src/app/(dashboard)/dashboard/cost-simulator/page.js` (new)
- `src/app/api/routing/simulate-cost/route.js` (new)

**What to do:** Let users project monthly costs under different routing configurations based on usage volume and constraints.

**Subtasks:**

1. Create `POST /api/routing/simulate-cost` endpoint:

   ```json
   {
     "requestsPerDay": 500,
     "avgInputTokens": 800,
     "avgOutputTokens": 400,
     "constraints": {
       "maxCostPerMTokens": 1.00,
       "preferFree": false,
       "preferLocal": false
     }
   }
   ```

   Response: expected monthly model distribution using actual catalog pricing, total cost, per-model breakdown, and comparison against an unconstrained baseline.

2. Create the Cost Simulator page at `/dashboard/cost-simulator` (Expert mode):
   - Input form: requests per day, average input tokens, average output tokens
   - Constraint sliders: max cost per million tokens, prefer free models toggle, prefer local toggle
   - Four scenario tabs: Current Config / Cost-Optimized / Quality-First / Custom
   - Results: horizontal bar chart of projected monthly cost by model (using Recharts, already a dependency)
   - "Risk warnings" panel: alerts for scenarios that trade cost for reliability (e.g., "Free models have rate limits that may cause failures at this volume")

3. Add "Save Scenario" to persist named scenarios in `localStorage` for later comparison.

4. Add "Apply to Playbook" button: pre-fills the playbook creation form with the constraints from the selected scenario.

**Context:** Pricing data is available in the model catalog. Use `catalogService.js` to get current pricing. The simulation does not call any provider — it's purely arithmetic over catalog data.

**Acceptance criteria:** Entering "1000 requests/day, prefer free models" produces a cost projection near $0 with at least one warning about rate limit risk.

---

### Task 3.3: Prompt Library (Expert Mode)

**Files:**
- `src/app/(dashboard)/dashboard/prompts/page.js` (new)
- `src/lib/localDb.js`
- `src/app/api/prompts/route.js` (new)
- `src/app/api/prompts/[id]/route.js` (new)

**What to do:** A Monaco-editor-based prompt template store with `{{variable}}` substitution, model testing, tagging, and export.

**Subtasks:**

1. Add `prompt_templates` table to SQLite in `localDb.js`:

   ```sql
   CREATE TABLE IF NOT EXISTS prompt_templates (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     description TEXT,
     template TEXT NOT NULL,
     variables TEXT,
     model_preference TEXT,
     tags TEXT,
     is_favorite INTEGER DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   ```

   `variables` and `tags` are JSON arrays stored as text.

2. Create CRUD API endpoints:
   - `GET /api/prompts` — list all templates (supports `?tag=` and `?q=` search)
   - `POST /api/prompts` — create
   - `GET /api/prompts/[id]` — get single
   - `PUT /api/prompts/[id]` — update
   - `DELETE /api/prompts/[id]` — delete

3. Create the Prompts page at `/dashboard/prompts`:
   - Left panel: searchable, filterable list with tag pills and favorite star
   - Right panel: Monaco editor for the template text (Monaco is already a dependency via `@monaco-editor/react`)

4. Variable handling:
   - Auto-detect all `{{variable_name}}` patterns in the template text as the user types
   - Generate labeled input fields for each unique variable name in a "Fill Variables" panel
   - Live preview of the fully substituted prompt

5. Test panel below the editor:
   - "Send to Router" button: substitutes variables, sends to `/v1/chat/completions` with the template's `model_preference` if set
   - Shows response inline

6. Add "Export All as JSON" and "Import from JSON" buttons for bulk backup/restore.

**Context:** Monaco editor is already installed (`@monaco-editor/react ^4.7.0`, `monaco-editor ^0.55.1`). Use the existing import pattern if one exists elsewhere in the codebase.

**Acceptance criteria:** User creates a template with 2 variables, fills both, clicks "Send to Router", and receives a response. The template persists after page reload and is searchable by name and tag.

---

### Task 3.4: Semantic Cache (Experimental)

**Files:**
- `src/lib/promptCache.js` (extend from Task 1.3)
- `src/lib/discovery/localDiscovery.js`
- Settings page

**What to do:** Extend the exact-match prompt cache (Task 1.3) with optional semantic similarity matching using locally-running Ollama embedding models. This is an experimental feature — off by default.

**Subtasks:**

1. Add `cache_embeddings` table to SQLite:

   ```sql
   CREATE TABLE IF NOT EXISTS cache_embeddings (
     hash TEXT NOT NULL,
     model TEXT NOT NULL,
     embedding TEXT NOT NULL,
     PRIMARY KEY (hash, model),
     FOREIGN KEY (hash, model) REFERENCES prompt_cache(hash, model) ON DELETE CASCADE
   );
   ```

   `embedding` is a JSON array of floats stored as text.

2. Add settings:
   - `semanticCacheEnabled` (default: `false`)
   - `semanticCacheThreshold` (default: `0.92`, range: 0.80–0.99)
   - `semanticCacheEmbeddingModel` (default: `nomic-embed-text`)

3. Cache flow with semantic cache enabled:
   1. SHA-256 exact match check (fast path, same as Task 1.3)
   2. On exact miss: if Ollama is available and semantic cache is enabled, generate an embedding of the incoming prompt using the configured model
   3. Compare against all stored embeddings using cosine similarity
   4. If similarity > threshold: return cached response with `X-Cache: SEMANTIC-HIT` header
   5. On miss: store response in cache and store its embedding in `cache_embeddings`

4. Add a helper in `localDiscovery.js` to call Ollama's `/api/embeddings` endpoint and return a float array.

5. Add a settings UI note: "Semantic cache requires Ollama running with an embedding model. Recommended: `ollama pull nomic-embed-text`"

6. Mark this feature with an "Experimental" badge in the settings UI.

**Context:** Cosine similarity of two float arrays: `dot(a, b) / (magnitude(a) * magnitude(b))`. Implement this in pure JavaScript — no new dependencies. The embedding vectors from `nomic-embed-text` are 768-dimensional.

**Acceptance criteria:** With semantic cache enabled and Ollama running, "What is the capital of France?" and "What's France's capital city?" return a `SEMANTIC-HIT` cache response above the 0.92 threshold.

---

### Task 3.5: Log Export Webhook

**Files:**
- `src/lib/logExporter.js` (new)
- `src/app/api/settings/webhooks/route.js` (new)
- Settings UI (webhooks section)

**What to do:** POST structured event payloads to user-configured webhook URLs after each request. Enables integration with Datadog, Grafana Loki, custom analytics dashboards, or n8n/Make automation workflows.

**Subtasks:**

1. Extend the settings schema with a `webhooks` array:

   ```json
   {
     "webhooks": [
       {
         "id": "uuid",
         "url": "https://...",
         "events": ["request_complete", "routing_error", "cache_hit"],
         "headers": { "Authorization": "Bearer token" },
         "enabled": true
       }
     ]
   }
   ```

2. Create `src/lib/logExporter.js`:
   - `export async function dispatchWebhookEvent(event, payload)` — iterates configured webhooks, filters by event type, POSTs the payload
   - Uses `fetch` with a 5-second timeout per request
   - Non-blocking: called with `dispatchWebhookEvent(...).catch(() => {})` so failures never affect the routing response
   - Retry: up to 3 attempts per webhook URL with 1s, 5s, 15s exponential backoff
   - Logs delivery results (success/failure) to a delivery history ring buffer (last 50 entries in memory, queryable via API)

3. Standard event payloads:

   ```json
   {
     "event": "request_complete",
     "traceId": "uuid",
     "timestamp": "ISO-8601",
     "model": "claude-3-5-sonnet",
     "provider": "anthropic",
     "intent": "code",
     "latencyMs": 823,
     "tokensIn": 450,
     "tokensOut": 280,
     "costEstimate": 0.00042,
     "success": true,
     "fallbackDepth": 0,
     "cacheHit": false
   }
   ```

4. Create `GET/POST /api/settings/webhooks` and `DELETE /api/settings/webhooks/[id]` endpoints.

5. Add webhooks section to settings UI:
   - Add / edit / delete webhook entries (URL, events multi-select, custom headers)
   - "Test" button: sends a test payload to the webhook URL and shows the HTTP response code
   - "Delivery Log" expandable section: shows last 50 deliveries with timestamp, event type, URL, status code, and latency

**Context:** All webhook POSTs must be fire-and-forget relative to the request path. Never await a webhook delivery inside the completions route handler.

**Acceptance criteria:** Add a webhook URL (e.g., requestbin.com or webhook.site), make a request, verify the payload arrives within 5 seconds with correct fields.

---

### Task 3.6: Routing Memory ML Enhancement

**Files:**
- `src/lib/routingMemory.js`
- `src/lib/routingIntelligence.js` (new)

**What to do:** The routing memory in `routingMemory.js` already captures intent, provider, model, and success outcomes per client. Build a lightweight local scoring model that learns from this history to improve future routing recommendations.

**Subtasks:**

1. Build `analyzeRoutingMemory(memoryData)` in new `src/lib/routingIntelligence.js`:
   - Compute per-intent success rates by model: which models have the highest success rate for each intent type on this install
   - Compute per-session/client provider failure patterns: which providers fail most often for a given session
   - Compute time-of-day patterns if the memory has > 500 entries (some providers are slower at peak hours)
   - Return a `{ intentModelBoosts, sessionProviderPenalties, timePatterns }` scoring adjustment object

2. Feed the `intentModelBoosts` results as a scoring bonus into the existing playbook scoring engine in `engine.js`. Models with high local success rates for the current intent get a bonus; models with poor local track records get a penalty.

3. Throttle the analysis: re-run at most once per hour, cache the result in memory. Don't run on every request.

4. Add a "Learning from your usage" indicator on the Analytics page when routing memory has more than 100 entries. Show a brief summary: "Top model for code: claude-3-5-sonnet (94% success rate in your usage)".

5. Add "Reset Routing Memory" button in settings (clears `routing_memory.json` or the equivalent SQLite table). Add a confirmation dialog explaining what this will reset.

**Context:** This must use only data already captured in `routingMemory.js`. Do not add new tracking that isn't already present. The scoring adjustments from this module must be clearly labeled in trace logs so developers can see when a local learning bonus was applied.

**Acceptance criteria:** After 50+ successful requests where one model consistently succeeds and another consistently fails for the same intent, the recommendation engine shows the successful model with a higher score than it would have received without the memory bonus.

---

## Milestone 4: v0.7 — Open Source Launch

**Status:** Completed

**Goal:** Release the community edition, establish contribution infrastructure, publish documentation, and define the plugin API for third-party extensions.

---

### Task 4.1: Repository Split and Build Automation

**Files:**
- `scripts/build-community.sh` (new)
- `.zippy-private` (new — root of repo, gitignored in public repo)
- `stubs/community/` (new directory tree)
- `.github/workflows/publish-community.yml` (new)
- `package.json` (add `build:community` script)

**What to do:** Implement the automated process that produces the community edition by replacing proprietary files with interface-compatible stubs before committing to the public repo.

**Subtasks:**

1. Create `.zippy-private` at the repo root listing all proprietary source paths (one per line):

   ```
   src/lib/discovery/p2pDiscovery.js
   src/lib/zippycoin-wallet.js
   src/lib/trustScore.js
   src/lib/wallet-management.js
   src/app/(dashboard)/dashboard/wallet/
   src/app/(dashboard)/dashboard/monetization/
   src/app/(dashboard)/dashboard/network/
   ```

2. Create stub files for each proprietary module at `stubs/community/[same-relative-path]`. Each stub must:
   - Export the same named exports and default export as the real implementation
   - Return `{ error: "This feature requires ZippyMesh Pro", code: "FEATURE_PRO" }` from all async functions
   - Throw `new Error("ZippyMesh Pro required")` from sync functions that the caller expects to return a value
   - Include a comment `// Community Edition Stub — upgrade to Pro for full functionality`

3. Create `scripts/build-community.sh`:
   - Read `.zippy-private` line by line
   - For each path, copy the corresponding file from `stubs/community/` over the source path
   - Strip any hardcoded internal endpoints or chain node URLs from `next.config.mjs` and `.env.example`
   - Run `npm run build:next` to verify the community build compiles without errors
   - Output a `community-dist/` directory ready for the public repo

4. Add `"build:community": "bash scripts/build-community.sh"` to `package.json`.

5. Create `./github/workflows/publish-community.yml` (note: use the actual `.github` directory name):
   - Trigger: on push of tag matching `v*`
   - Steps: checkout → run build:community → push `community-dist/` to the `community` branch of the public repo

**Context:** The stub interface must be exactly compatible with the real implementation's exported API. Any callers of proprietary modules must still compile and start cleanly with stubs — they just receive an error response when those features are invoked at runtime.

**Acceptance criteria:** `npm run build:community` produces a project that compiles without TypeScript/ESLint errors, starts successfully with `npm start`, and handles basic routing requests (the core routing path must be fully functional in the community edition).

---

### Task 4.2: Plugin Architecture

**Files:**
- `src/lib/plugins/pluginRegistry.js` (new)
- `src/lib/plugins/pluginInterface.js` (new — type definitions and validation)
- Plugin example: `src/plugins/example-provider/index.js` (new)

**What to do:** Define a stable, versioned plugin interface so community contributors can add providers, guardrail rules, and routing logic extensions without modifying the core codebase.

**Subtasks:**

1. Define the plugin interface in `pluginInterface.js`:

   ```js
   // Plugin types: 'provider' | 'guardrail' | 'routing-rule'
   // All plugins must export a default object matching this shape:
   {
     type: 'provider',
     name: 'my-provider',
     version: '1.0.0',
     description: 'Human-readable description',
     async init(config) {},           // Called once on load; receives plugin config from settings
     // Provider plugins additionally implement:
     async listModels() {},           // Returns normalized model objects
     async chatCompletion(body) {},   // Returns OpenAI-compatible response
     async getHealth() {},            // Returns { ok: bool, message? }
     // Guardrail plugins additionally implement:
     async checkRequest(messages) {}, // Returns { allowed: bool, modified?: messages, reason?: string }
     // Routing-rule plugins additionally implement:
     scoreCandidate(candidate, context) {}, // Returns numeric score delta
   }
   ```

2. Create `pluginRegistry.js`:
   - On startup, scan `~/.zippy-mesh/plugins/` directory (create if missing)
   - For each subdirectory, attempt to `require()` its `index.js`
   - Validate the exported object against the interface using the `pluginInterface.js` schema
   - Register valid plugins; log and skip invalid ones with a warning
   - Expose `getPlugins(type)` and `getPlugin(name)` to the rest of the application

3. Provider plugins integrate with the existing provider system: when a provider plugin registers, its `listModels()` result is merged into the catalog with prefix `plugin:[name]/`.

4. Guardrail plugins are appended to the active guardrails pipeline.

5. Routing-rule plugins can inject score adjustments into the candidate scoring phase.

6. Security constraints:
   - Plugins run in the same Node.js process but have no direct database access (no import of `localDb.js`)
   - Plugins should not be able to intercept or modify response data after it leaves the routing engine
   - Add a note in the plugin README: "Plugins are loaded from `~/.zippy-mesh/plugins/`. Only install plugins from sources you trust."

7. Create an example provider plugin at `src/plugins/example-provider/index.js` that returns a hardcoded mock response. Include it in the documentation as the reference implementation.

**Acceptance criteria:** Place the example plugin in `~/.zippy-mesh/plugins/example-provider/`. After restarting ZMLR, the provider list includes `plugin:example-provider` and a completion request routed to it returns the mock response.

---

### Task 4.3: Documentation Site

**Files:**
- `docs/` directory (new, structured content)
- `docs/docusaurus.config.js` (or equivalent static site config)
- `.github/workflows/deploy-docs.yml` (new)

**What to do:** A comprehensive documentation website covering all user-facing features, API reference, and developer guides. Deployable to GitHub Pages from the `docs/` directory.

**Subtasks:**

1. Set up Docusaurus (or a lightweight alternative like VitePress) in the `docs/` directory. Include a `docs/package.json` separate from the main application so the docs tool chain does not pollute the main dependencies.

2. Create the following documentation sections:

   **Getting Started**
   - Requirements (Node.js version, OS, optional: Ollama for local models)
   - Installation: binary (Tauri), npm, Docker, build from source
   - First-run setup wizard walkthrough
   - Quick-start: getting your first request through the router

   **Core Concepts**
   - Providers and connections
   - Fallback chains (combos)
   - Routing rules (playbooks) and intents
   - Smart routing headers (all 10 headers from Task 1.7)
   - Session routing and routing memory
   - Prompt cache and semantic cache

   **API Reference**
   - `/v1/chat/completions` — full request/response schema
   - `/v1/models` — model listing
   - All `/api/routing/*` endpoints
   - All `/api/providers/*` endpoints
   - All `/api/keys/*` endpoints
   - Authentication: API keys and virtual keys

   **Playbook Guide**
   - Rule types: boost, filter-in, filter-out, sort
   - Intent types and when to use each
   - Priority system and score calculation
   - Building a cost-optimized ruleset
   - Building a privacy-first ruleset
   - Template gallery reference

   **Developer Guide**
   - Plugin development: implementing a provider plugin
   - Plugin development: implementing a guardrail plugin
   - Contributing to the community edition
   - Architecture overview (reference `ARCHITECTURE.md`)

   **Migration Guide**
   - Upgrading from v0.x to v1.0
   - Migrating from LiteLLM
   - Migrating from OpenRouter (self-hosted)

3. Create `.github/workflows/deploy-docs.yml` to build and deploy the docs site to GitHub Pages on every push to `main`.

**Acceptance criteria:** `cd docs && npm run build` produces a static site. The site is deployed and accessible at the project's GitHub Pages URL.

---

## Milestone 5: v1.0 — Enterprise Ready

**Status:** Completed

**Goal:** Make ZMLR suitable for team and organizational deployment with proper access control, compliance tooling, and the community ecosystem.

---

### Task 5.1: Multi-Tenancy

Extend the virtual key management system (Task 2.3) to full multi-tenancy:

- **Organizations:** top-level container for all resources
- **Teams:** subdivisions within an org with their own routing rules and provider access
- **Users:** individuals with a role (admin, operator, viewer) within a team
- **Isolation:** each tenant gets isolated routing rules, analytics, and API quotas
- **RBAC:** role-based access control enforced at the API middleware layer
- **Database schema:** `organizations`, `teams`, `users` tables with foreign keys on `virtual_keys`, `routing_playbooks`, and `request_traces`

This task requires significant schema changes. Plan for a migration window and follow the migration patterns in Section 7.

---

### Task 5.2: Advanced Compliance Features

**HIPAA path:**
- PII scrubbing enabled by default (with audit log of what was scrubbed)
- Immutable audit logs: append-only `audit_log` table, no DELETE or UPDATE
- Configurable data retention: auto-purge traces older than N days
- Data residency: all data stays local (ZMLR's architecture already ensures this)

**SOC2 path:**
- Access logs for all dashboard actions (who changed what, when)
- Change tracking: before/after snapshots for settings and routing rule changes
- MFA support: TOTP-based second factor for dashboard login

**GDPR path:**
- "Delete my data" per virtual key: purge all traces, cached prompts, and routing memory associated with a key
- Minimal retention mode: set global trace retention to 24 hours
- Data export: export all data associated with a key as JSON

---

### Task 5.3: SLA Monitoring

- Per-provider uptime tracking with historical data stored in SQLite
- Configurable SLA thresholds per provider (e.g., 99.5% uptime, < 2000ms P95 latency)
- Alert system: in-dashboard notification and optional webhook event when SLA breach detected
- Auto-disable: providers that fall below SLA threshold for > 1 hour are automatically excluded from routing until manually re-enabled
- Weekly SLA report: auto-generated summary viewable in Analytics, exportable as PDF or CSV
- Provider status page: real-time uptime/latency dashboard per provider with 30-day historical sparklines

---

### Task 5.4: Community Marketplace

**Dependencies:** Task 3.6 (routing memory), P2P mesh (milestone requirement), ZippyCoin billing

- Community playbook sharing via a ZMLR cloud registry (hosted by ZippyMesh, the company)
- Browse and search published playbooks by intent, tag, download count, and rating
- One-click install: download and import a community playbook from the registry
- Rating and review system for shared playbooks
- Author attribution and version history
- ZippyCoin micro-rewards for highly-rated community contributions (requires ZippyCoin billing to be live — defer until P2P monetization milestone)

---

## 5. Chain ID Selection

**Decision: Use Chain ID 947 for ZippyCoin mainnet.**

| Chain | ID | Notes |
|---|---|---|
| ZippyCoin Mainnet | **947** | Z(9)+I(4)+P(7) on touch-tone keypad = "ZIP" |
| ZippyCoin Testnet | **94779** | Z(9)+I(4)+P(7)+P(7)+Y(9) = "ZIPPY" — available |
| ~~Previous value~~ | ~~777~~ | Claimed on chainlist.org — do not use |

**Rationale:** Chain ID 777 is already registered on chainlist.org and must not be used. 947 is the touch-tone encoding of "ZIP" and is a memorable, available chain ID. 94779 encodes "ZIPPY" and is available as the testnet chain ID.

**Implementation notes:**
- The wallet client fetches the chain ID dynamically via RPC (`eth_chainId`), so no wallet code changes are needed
- Only the ZippyCoin node configuration and any documentation referencing 777 need to be updated
- The comment in `src/lib/zippycoin-wallet.js` has already been corrected (Task 1.1)

All new documentation, node configuration templates, and chain registration submissions must use:
- Mainnet: `chainId: 947`, `networkName: "ZippyCoin"`, `symbol: "ZIP"`
- Testnet: `chainId: 94779`, `networkName: "ZippyCoin Testnet"`, `symbol: "tZIP"`

---

## 6. Open Questions / Decisions Needed

These are unresolved strategic decisions that affect the roadmap. The project owner should decide each before the relevant milestone begins.

- [ ] **License model:** Is the community edition free and MIT-licensed, or source-available under a custom license (e.g., BSL, SSPL)? This affects how aggressively competitors can fork the project.

- [ ] **Repo structure:** Should the public repo be a separate repository built by the community build script, or a single repo with a protected branch for the full private edition?

- [ ] **Pro vs Community feature split:** The current plan places P2P networking and ZippyCoin as Pro features. Should virtual key management and the prompt library also be Pro, or remain in the community edition?

- [ ] **Virtual key management tier:** Virtual keys with per-project budgets are valuable for teams. If they're community-only, it differentiates ZMLR from OpenRouter. If they're Pro, it's a revenue opportunity. Decide by start of v0.5.

- [ ] **v0.4 release date target:** No date is currently set. Establishing a target (even a rough one) helps prioritize Tasks 1.2–1.7.

- [ ] **ZippyCoin node open-source:** Should the ZippyCoin chain node be open-sourced separately, remain proprietary, or be submitted to public chain registries? This is an independent decision from the ZMLR router open-source strategy.

---

## 7. Upgrade Path

### 7.1 Schema Migration Pattern

Every schema change in ZMLR follows this established pattern (already in use in `src/lib/localDb.js`):

1. **New tables:** Always use `CREATE TABLE IF NOT EXISTS` — safe to run on every startup
2. **New columns on existing tables:** Use the `ensureColumn()` helper or equivalent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` logic — safe to run on every startup
3. **Never** rename or drop columns in patch or minor releases — they may contain user data
4. **Never** change a column's data type in place — add a new column and migrate data in a background job
5. Document every breaking schema change in `CHANGELOG.md` with exact migration SQL and rollback instructions

New tables introduced by this roadmap (by task):
- `request_traces` — Task 1.2
- `prompt_cache` — Task 1.3
- `cache_embeddings` — Task 3.4
- `virtual_keys` — Task 2.3
- `prompt_templates` — Task 3.3

### 7.2 Settings Migration

- `INITIAL_SETTINGS` in `localDb.js` (or wherever settings defaults are defined) is the source of truth for default values
- On every startup, merge user settings with `INITIAL_SETTINGS`: user values win, missing keys receive defaults
- `settings_version` field in settings tracks the migration state for breaking changes
- New settings keys introduced by this roadmap:
  - `promptCacheEnabled`, `promptCacheTtlSeconds` — Task 1.3
  - `semanticCacheEnabled`, `semanticCacheThreshold`, `semanticCacheEmbeddingModel` — Task 3.4
  - `webhooks` — Task 3.5

### 7.3 lowdb (db.json) Migrations

- Migration scripts live in `scripts/migrate/`
- Naming convention: `scripts/migrate/[version]-[description].mjs`
- Run in ascending version order on startup if `db.json` version field is below current
- Always write a backup of `db.json` to `db.json.bak.[timestamp]` before running any migration
- All migrations must be reversible — document the undo command in `CHANGELOG.md`

### 7.4 Binary / Desktop App Upgrade (Tauri)

- Auto-update: Tauri checks `NEXT_PUBLIC_UPDATE_URL` on startup for a new version manifest
- Dashboard shows an "Update available" badge with version and release notes link
- User initiates the update from the dashboard — no silent auto-install
- The data directory (`DATA_DIR`) is preserved across Tauri binary updates
- After a Tauri update, ZMLR runs its schema migration checks on first startup

### 7.5 Rollback Policy

| Change type | Rollback strategy |
|---|---|
| New SQLite table | Drop the table (no data loss if empty) |
| New SQLite column | Column remains but is ignored by older code |
| New setting key | Key is ignored by older builds |
| db.json migration | Restore from `db.json.bak.[timestamp]` |
| Tauri binary | Restore previous binary from `dist/` backup |

---

---

## Pre-Launch Validation Checklist

**Status:** In Progress
**Gate:** All items must pass before `GoZippy/zippymesh-router` is made public.

This is not a feature milestone — it is a release quality gate. Nothing ships publicly until every item here is green.

---

### PL-1: Git History Audit

**Goal:** Guarantee that no commit in the full history ever exposed a real secret, API key, token, or password.

- [x] Full history scan for `sk-*`, `ghp_`, `gho_`, `AIza`, `GOCSPX-`, `-----BEGIN PRIVATE KEY` patterns — **0 matches** (2026-03-19)
- [x] `.env*` files in history: all are `.env.example` only — no real `.env` committed
- [x] `*.db`, `oauth-secrets.json` — never committed
- [x] `data/`, `.voidspec/`, `.vscode/` — never committed
- [x] `node secrets-check.cjs` exits 0 on current HEAD
- [ ] Independent verification with `gitleaks` or `trufflehog` (run before making GoZippy/zippymesh-router public)

**Tools:**
```bash
# Install gitleaks and scan full history
docker run --rm -v $(pwd):/repo zricethezav/gitleaks:latest detect --source /repo --log-level info
```

---

### PL-2: Cross-Platform Distribution

**Goal:** One-command install for Windows, macOS, and Linux users with zero developer experience required.

**Windows**
- [ ] Tauri `.msi` installer: installs to `Program Files`, adds Start Menu shortcut, auto-starts on login option
- [ ] NSIS fallback installer for users who can't run `.msi`
- [ ] Test on Windows 10 and Windows 11 (clean VM, no Node.js pre-installed)
- [ ] Validate: double-click installer → browser opens to `http://localhost:20128/dashboard` → setup wizard runs

**macOS**
- [ ] Tauri `.dmg` with drag-to-Applications
- [ ] Code-signed with Apple Developer ID (required for Gatekeeper)
- [ ] Test on macOS 13 (Ventura) and macOS 14 (Sonoma) — Intel and Apple Silicon
- [ ] Validate: open `.dmg` → drag → launch → setup wizard

**Linux**
- [ ] `.AppImage` (universal, no install required — just `chmod +x` and run)
- [ ] `.deb` package for Ubuntu/Debian
- [ ] `.rpm` for Fedora/RHEL
- [ ] Test on Ubuntu 22.04 LTS and Ubuntu 24.04 LTS (clean VMs)
- [ ] Validate: `./ZippyMesh.AppImage` → browser opens → setup wizard

**Node.js "from source" path (power users)**
- [ ] `git clone` → `npm install` → `npm start` works on all three platforms without extra steps
- [ ] `npm run build:community` produces a working `community-dist/` on all platforms
- [ ] Document minimum requirements: Node.js 20+, 2GB RAM, 500MB disk

---

### PL-3: Automated Install & Workflow Testing

**Goal:** A CI pipeline that provisions a clean VM, installs ZippyMesh, and validates every core user flow end-to-end.

- [ ] **Install test**: Fresh Ubuntu 22.04 VM → install AppImage → assert health endpoint responds within 30s
- [ ] **Setup wizard**: Playwright/Puppeteer test navigates setup wizard, sets password, completes onboarding
- [ ] **Provider connect**: Add an Ollama provider (local, no API key needed for CI) → assert model list populates
- [ ] **Chat completion**: POST to `/v1/chat/completions` → assert valid streaming response with `choices[]`
- [ ] **Smart routing**: POST with `X-Intent: code` header → assert `x-routing-intent` response header present
- [ ] **Virtual key**: Create a virtual key → use it in a request → assert `tokens_used_this_month` increments
- [ ] **Prompt cache**: Same prompt twice → assert second response has `X-Cache: HIT`
- [ ] **Dashboard loads**: All 10 dashboard pages return 200 with no console errors
- [ ] **Upgrade test**: Install v0.x → replace binary with v1.0 → assert DB migration runs → assert existing data preserved

**CI infrastructure:**
- GitHub Actions matrix: `ubuntu-22.04`, `windows-2022`, `macos-13`
- Workflow file: `.github/workflows/e2e-install.yml`
- Runs on every PR to `main` and every release tag

---

### PL-4: ZippyCoin / Wallet Feature Gate Decision

**Status:** ✅ Resolved — Option C selected (keep visible, label as Early Alpha Testnet Only)

**Decision (2026-03-18):** Keep all ZippyCoin wallet/network/monetization pages fully visible and accessible. Each page displays an `AlphaTestnetBanner` that clearly communicates:
- Features are early alpha on testnet only
- ZippyMesh LLM Router works fully without ZippyCoin — AI routing, providers, and dashboard are unaffected
- Users should not rely on ZippyCoin mesh features until full public release
- Bug reports and feedback are welcomed via GitHub issues

**Implementation complete:**
- [x] `src/shared/components/AlphaTestnetBanner.js` — reusable yellow warning banner
- [x] `src/app/(dashboard)/dashboard/wallet/page.js` — banner added ("The ZippyCoin wallet")
- [x] `src/app/(dashboard)/dashboard/network/page.js` — banner added ("P2P mesh networking")
- [x] `src/app/(dashboard)/dashboard/monetization/page.js` — banner added ("Node monetization via ZippyCoin")

**Rationale:** Hiding features reduces community trust and hides the core ZippyMesh vision. Labeling as testnet-only communicates maturity level honestly, gives early testers visibility into the roadmap, and allows gathering feedback before public launch.

---

### PL-5: Security Hardening Pass

- [x] Rate limiting on dashboard login endpoint (max 5 attempts per 15 min per IP) — `src/lib/auth/ipRateLimit.js` + `api/auth/login/route.js`
- [x] Rate limiting on `/v1/chat/completions` for requests without a virtual key (200 req/hr per IP)
- [x] `Content-Security-Policy` header on all pages — `next.config.mjs` `headers()` block
- [x] `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection` on all responses
- [x] Dependency audit: `npm audit` zero high/critical vulnerabilities (`npm audit fix` applied 2026-03-18; 7 moderate remain in vitest/vite dev deps only)
- [x] `JWT_SECRET` entropy check at startup — rejects if < 32 chars or matches known weak defaults

---

### PL-6: ZippyVault Integration

- [x] ZippyVault Phase 1 (local only) shipped — `src/lib/vault.js` + `src/app/api/vault/`
- [x] DB tables: `vault_entries` (AES-256-GCM encrypted), `vault_agent_requests` (permission log)
- [x] Vault dashboard page at `/dashboard/vault-keys` accessible from sidebar
- [x] Crypto: PBKDF2-SHA256 210k iterations, per-entry random salt, AES-256-GCM with auth tag
- [x] ZippyMesh auto-reads provider API keys from vault — `src/sse/services/auth.js` falls back to vault when `connection.apiKey` is null and vault is unlocked
- [x] Vault step in setup wizard (step 3 of 5) — optional, skippable, links to vault dashboard
- [ ] Phase 2: optional sync to vault.zippymesh.com (cloud backup, multi-device)

---

### PL-7: Launch Readiness Review

Final manual checks before flipping `GoZippy/zippymesh-router` to public:

- [x] README.md — rewritten as proper source-code README with quick-start, feature list, architecture overview
- [x] `LICENSE` file — present at repo root (Zippy Technologies Source-Available Commercial Install License v1.1)
- [x] `CONTRIBUTING.md` — present
- [x] All links in docs point to correct URLs (localhost refs in README/CONTRIBUTING are correct quick-start examples; integration guide port 3200 refs are OpenClaw's port, not ZMLR)
- [x] The community build (`npm run build:community`) runs cleanly — 39 routes compiled, 0 errors (2026-03-19)
- [ ] A human has manually run through the setup wizard on a clean machine
- [ ] GitHub repo description, topics, and social preview image are set
- [ ] `vault.zippymesh.com` or `lock.zippymesh.com` domain is configured (for ZippyVault Phase 2 sync)

---

## Milestone 6: ZippyVault

**Status:** Design complete (see `docs/ZIPPYVAULT_DESIGN.md`) — Phase 1 scaffolding in progress.

**Goal:** User-facing encrypted credential store, local-first with optional sync to `vault.zippymesh.com`. Replaces the pattern of storing API keys directly in ZippyMesh settings with a proper secrets manager that any GoZippy tool can request access to.

**Phases:**
- **Phase 1** (local): Encrypted vault in `~/.zippymesh/vault.db`, dashboard UI, agent permission model
- **Phase 2** (sync): End-to-end encrypted sync to `vault.zippymesh.com` — server stores only ciphertext
- **Phase 3** (ecosystem): ZippyCoin identity ties to vault; other GoZippy dApps request credentials via the vault permission protocol

See `docs/ZIPPYVAULT_DESIGN.md` for full architecture, encryption scheme, API surface, and phased rollout plan.

---

*End of ROADMAP.md — last updated 2026-03-18*
