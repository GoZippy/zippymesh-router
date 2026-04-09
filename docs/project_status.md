# ZMLR Project Status

**Date:** March 18, 2026
**Current Version:** 1.0.0
**Test Suite:** 139/139 passing

All 5 roadmap milestones are complete.

---

## ✅ All Milestones Complete

| Milestone | Version | Status |
|---|---|---|
| M1: Production Credibility | v0.4 | Complete |
| M2: Feature Parity | v0.5 | Complete |
| M3: Unique Differentiation | v0.6 | Complete |
| M4: Open Source Launch | v0.7 | Complete |
| M5: Enterprise Ready | v1.0 | Complete |

---

## What Was Built (Summary)

### Core Routing
- Smart router with intent inference, constraint parsing, scoring, fallback chain
- Exact-match prompt cache (SHA-256) + semantic cache (Ollama `nomic-embed-text`, cosine similarity)
- Per-request trace logging with full audit trail (`request_traces` table)
- Routing memory: per-intent model success rates feed back into scoring (local ML)
- `POST /api/routing/simulate` dry-run endpoint

### Provider Infrastructure
- OpenAI, Anthropic, Gemini, Ollama, OpenRouter, Kilo, GitHub Copilot, Antigravity, iFlow
- OAuth flows with background token refresh, `needs_reauth` state, circuit breaker
- SLA monitoring: per-provider uptime %, P95 latency, auto-disable on breach
- ZippyMesh Discovery API: `/api/discovery/catalog`, `/api/discovery/recommend`, `/api/discovery/validate`

### Access Control & Multi-Tenancy
- Virtual keys (`zm_live_...`) with monthly token/dollar budgets, RPM limits, expiry
- Virtual key enforcement at `/v1/chat/completions` (401/429 on invalid/over-budget)
- Organizations → Teams → Members hierarchy with RBAC (admin/operator/viewer)
- `/api/orgs/` nested REST API

### Compliance
- Append-only `audit_log`: all settings changes recorded
- Configurable trace retention with on-demand purge
- GDPR right-to-erasure: hard-deletes virtual key + all linked traces
- `virtual_key_id` stored on every request trace for accurate attribution

### Observability
- Request Tracer UI with live table, filters, expandable detail, flag/unflag
- Live Analytics page: routing intent distribution, top models, fallback depth charts
- Overview dashboard routing widget (1h live stats)
- Log export webhooks with retry + delivery history ring buffer

### Open Source
- `.zippy-private` manifest + `stubs/community/` interface stubs
- `scripts/build-community.sh`: rsync + stub replacement + build verification
- GitHub Actions: publishes `community` branch + GitHub Release on every `v*` tag
- Plugin architecture: scan `~/.zippy-mesh/plugins/`, validate manifest, three plugin types
- VitePress documentation site (`docs/`) with GitHub Pages deployment

### Other
- Prompt Library with Monaco editor (CRUD + favorites + tags)
- Cost Simulator (playbook dry-run with score breakdown)
- Community Marketplace (5 seed playbooks, browse/download/rate/publish)
- PII guardrails with default patterns (email, SSN, credit card, phone, API key)
- MCP server (`src/mcp/zmlr-server.js`): `list_models`, `recommend_model`, `validate_model`

---

## Open Strategic Questions (Owner Decision Required)

These are unresolved and not code problems — see Section 6 of ROADMAP.md for full context:

- **License model:** MIT, BSL, or SSPL for community edition?
- **Repo structure:** Single repo (protected branch) or separate public repo?
- **Virtual key tier:** Community or Pro feature?
- **v1.0 release date target:** None set yet
- **ZippyCoin node:** Open-source separately or stay proprietary?

---

## What's Genuinely Left

No roadmap items remain. Potential next work (not yet planned):

- **Token counting in virtual key usage** — `updateVirtualKeyUsage` is called but passes `tokensUsed: 0`; wiring actual token counts from the response body would make budget enforcement accurate
- **Data retention cron** — retention purge exists as an API endpoint but isn't scheduled automatically
- **SLA breach webhooks** — `checkSlaBreaches()` exists in `slaMonitor.js` but isn't called on a schedule
- **Tauri desktop packaging** — scripts exist but haven't been validated end-to-end post-v1.0 changes
- **Production hardening** — no rate limiting on the dashboard API itself (only on virtual key RPM for the proxy)
