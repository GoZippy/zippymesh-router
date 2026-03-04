# Zippy Mesh - AI Routing & Endpoint Proxy

**Local-first AI endpoint proxy with web dashboard. Smart routing, format translation, and multi-provider fallback.**

Open source router core. Audit the code. Your prompts and keys never leave your control. See [NOTICE.md](NOTICE.md) and [SECURITY.md](SECURITY.md). For code classification (public vs proprietary, distributable vs private), see [docs/DISTRIBUTION_PLAN.md](docs/DISTRIBUTION_PLAN.md).

---

## What It Does

ZippyMesh sits between your CLI tools (Claude Code, Codex, Cline, etc.) and upstream AI providers. It provides:

- **Single OpenAI-compatible endpoint** (`/v1/*`) for all your tools
- **Smart fallback** — auto-route through subscription, cheap, and free tiers
- **Format translation** — OpenAI, Claude, Gemini formats translated seamlessly
- **Multi-account support** — round-robin or priority-based routing
- **Auto token refresh** — OAuth tokens refreshed automatically
- **Custom combos** — build fallback chains across providers
- **Usage tracking** — token counts, cost estimation, request logs
- **Service Discovery** — auto-validation of credentials and health checks
- **Context Compression** — smart summarization to fit context limits
- **Web dashboard** — manage providers, keys (including local router API keys), combos, and settings
- **API key security** — create scoped API tokens, enable enforcement via settings, and auto-blacklist abusive clients
- **Firewall integration** — optional helper to apply host firewall rules (UFW/Defender/pf) when blacklisting

## Privacy & Telemetry

ZippyMesh is designed with privacy as a core principle. Unlike some similar routing proxies, ZippyMesh:

- **No built-in telemetry** — the router does not phone home, send usage analytics to external servers, or collect data beyond what you configure locally
- **Local-first** — all provider credentials, usage data, and configuration stay on your machine
- **Optional cloud sync** — if you enable cloud sync, data is sent only to endpoints you explicitly configure (`NEXT_PUBLIC_CLOUD_URL`)
- **Transparent** — usage logs and request logs are stored locally and only when you enable `ENABLE_REQUEST_LOGS`

Your prompts, responses, and API keys never leave your control unless you explicitly route them through upstream providers you connect. See [docs/PRIVACY.md](docs/PRIVACY.md) for details.

## Quick Start

### Running Tests

Unit tests (no server required):

```bash
npm install            # if not already done
npm run test           # router API key: create, verify, revoke, blacklist
npm run test:providers # provider config, sync, adapters, Kilo routing
```

Integration tests (server must be running; uses default password or `INITIAL_PASSWORD`):

```bash
npm run dev            # in one terminal
node scripts/run_tests.mjs   # in another; set INITIAL_PASSWORD if needed
```

A secondary script (`verify_firewall.js`) attempts to apply default firewall
rules and blacklist an example IP.  It is meant for manual verification on a
supported host; it will not harm your configuration if run as a normal user.

```bash
node verify_firewall.js
```


### From Source

First-time or installer setup (creates `.env` with generated secrets; use `--force` to overwrite):

```bash
npm install
npm run setup              # creates .env (default password: admin)
# Or: node scripts/setup-env.mjs --password=yourpassword
npm run build
PORT=20128 HOSTNAME=0.0.0.0 npm run start
```

To configure manually instead: copy `.env.example` to `.env`, set `JWT_SECRET`, `INITIAL_PASSWORD`, `DATA_DIR`.

Dashboard: `http://localhost:20128/dashboard`
API endpoint: `http://localhost:20128/v1`

### Docker

```bash
docker build -t zippy-mesh .
docker run -d \
  --name zippy-mesh \
  -p 20128:20128 \
  --env-file .env \
  -v zippymesh-data:/app/data \
  zippy-mesh
```

## How It Works

```
Your CLI Tool (Claude Code, Codex, Cline...)
    │
    │ http://localhost:20128/v1
    ↓
┌─────────────────────────────────────────┐
│         ZippyMesh (Smart Router)        │
│  • Format translation (OpenAI ↔ Claude) │
│  • Quota tracking & auto token refresh  │
│  • Account fallback & combo routing     │
└──────┬──────────────────────────────────┘
       │
       ├─→ [Tier 1] Subscriptions (Claude, Codex, Gemini CLI)
       ├─→ [Tier 2] Cheap APIs (GLM, MiniMax, Kimi)
       └─→ [Tier 3] Free providers (iFlow, Qwen, Kiro)
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | **Yes** | JWT signing secret (app refuses to start without it) |
| `INITIAL_PASSWORD` | Recommended | First login password (set in .env; required for first-time setup) |
| `DATA_DIR` | Recommended | Database location (default: `~/.zippymesh`) |
| `PORT` | No | Service port (default: framework default) |
| `API_KEY_SECRET` | Recommended | HMAC secret for generated API keys |
| `ENABLE_FIREWALL` | No | When true, router attempts to configure OS firewall on blacklist events |
| `MACHINE_ID_SALT` | Recommended | Salt for stable machine ID hashing |
| `ENABLE_REQUEST_LOGS` | No | Enable request/response debug logs |
| `NEXT_PUBLIC_BASE_URL` | No | Internal base URL for self-referencing API calls |

## API Compatibility

- `POST /v1/chat/completions` — OpenAI-compatible chat
- `POST /v1/messages` — Anthropic-compatible messages
- `POST /v1/responses` — OpenAI Responses API
- `GET /v1/models` — List all available models + combos
- `POST /v1/messages/count_tokens` — Token counting
- Gemini-style endpoints via `/v1beta/models/*`

Use the exact `id` from `GET /v1/models` as the `model` in `POST /v1/chat/completions`. On 429, the error body may include `error.alternatives` (model IDs in the same format) and `error.retry_after_seconds`; clients can retry with an alternative or wait. For failover suggestions: `GET /api/routing/suggestions?model=alias/modelId` returns equivalent models in client format, `isFree` flag, and recommended `failoverOrder`.

## CLI

With the server running, use the script for list-models, failover suggestions, and health check:

```bash
npm run cli list-models
npm run cli suggest-failover --model=anthropic/claude-3-5-sonnet
npm run cli test
```

Set `ZIPPY_BASE_URL` to override the base URL (default `http://localhost:20128`).

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Next.js 16
- **UI**: React 19 + Tailwind CSS 4
- **Database**: LowDB (JSON file-based)
- **Streaming**: Server-Sent Events (SSE)
- **Auth**: OAuth 2.0 (PKCE) + JWT + API Keys

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture documentation.


## License

MIT License - see [LICENSE](LICENSE) for details.
