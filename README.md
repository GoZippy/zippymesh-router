# Zippy Mesh - AI Routing & Endpoint Proxy

**Local-first AI endpoint proxy with web dashboard. Smart routing, format translation, and multi-provider fallback.**

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
- **Web dashboard** — manage providers, keys, combos, and settings

## Quick Start

### From Source

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET, INITIAL_PASSWORD, DATA_DIR
npm install
npm run build
PORT=20128 HOSTNAME=0.0.0.0 npm run start
```

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
| `INITIAL_PASSWORD` | Recommended | First login password (default: `123456`) |
| `DATA_DIR` | Recommended | Database location (default: `~/.zippymesh`) |
| `PORT` | No | Service port (default: framework default) |
| `API_KEY_SECRET` | Recommended | HMAC secret for generated API keys |
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
