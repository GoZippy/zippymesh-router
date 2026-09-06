# ZippyMesh LLM Router

**One endpoint. Any AI model. Smart routing.**

ZippyMesh LLM Router (ZMLR) is an OpenAI-compatible local gateway that routes AI requests across multiple providers — Ollama, OpenAI, Anthropic, Groq, Google Gemini, Kilo, and more. Drop it in front of any OpenAI-compatible client and get intelligent model selection, cost controls, fallback chains, and a full dashboard — without changing your app.

[![License: Source-Available](https://img.shields.io/badge/license-source--available-blue)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-20%2B-green)](https://nodejs.org/)

---

## Features

- **OpenAI-compatible** — works with Cursor, Claude Code, LangChain, LiteLLM, and any `/v1/chat/completions` client
- **Smart routing** — intent detection (`X-Intent: code`), constraint headers, automatic fallback chains
- **Multi-provider** — Ollama (local), OpenAI, Anthropic, Groq, Gemini, Kilo, OpenRouter, and more
- **Dashboard** — provider management, routing playbooks, virtual keys, analytics, cost simulator
- **Virtual keys** — per-team API keys with token budgets, rate limits, and GDPR-clean purge
- **Prompt cache** — exact-match and semantic caching to reduce costs and latency
- **ZippyVault** — local AES-256-GCM encrypted credential store (early access)
- **ZippyCoin mesh** — P2P node monetization and billing via ZippyCoin (early alpha / testnet only)

---

## Quick start

### Requirements

- **Node.js 20+** (LTS recommended) — [nodejs.org](https://nodejs.org/)
- **npm 10+**

### Install from source

```bash
git clone https://github.com/GoZippy/zippymesh-router.git
cd zippymesh-router
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
JWT_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
INITIAL_PASSWORD=your-dashboard-password
```

### Run

```bash
npm run dev        # development (hot reload)
# or
npm start          # production standalone
```

Dashboard opens at **http://localhost:20128/dashboard**

---

## Usage

Point any OpenAI client at `http://localhost:20128/v1`:

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'
```

### Smart routing headers

```bash
# Route by intent
curl ... -H "X-Intent: code"

# Prefer free/local models
curl ... -H "X-Prefer-Free: true"

# Latency constraint
curl ... -H "X-Max-Latency-Ms: 2000"
```

Response includes routing metadata:
```
x-selected-model: openai/gpt-4o
x-routing-intent: code
x-routing-score: 92
```

---

## Configuration

See `.env.example` for all options. Key settings:

| Variable | Description |
|---|---|
| `JWT_SECRET` | Required. 32+ char secret for dashboard auth |
| `INITIAL_PASSWORD` | Dashboard login password |
| `PORT` | HTTP port (default: 20128) |
| `OPENROUTER_API_KEY` | Access 300+ models via a single key |
| `NEXT_PUBLIC_ZIPPYCOIN_RPC_URL` | ZippyCoin node RPC (testnet only) |

---

## Architecture

```
Client (any OpenAI-compatible tool)
        │  POST /v1/chat/completions
        ▼
  ZippyMesh LLM Router
  ├── Smart Router (intent, constraints, scoring)
  ├── Provider Registry (Ollama, OpenAI, Anthropic, Groq, …)
  ├── Fallback Engine (automatic retry on failure)
  ├── Prompt Cache (exact + semantic)
  ├── Virtual Key Enforcement (budget, rate limits)
  └── Request Tracer (analytics, SLA, audit log)
        │
        ▼
  Upstream AI Provider
```

### Open-core model

This repository is the **open-core** edition: UI, configuration, API scaffolding, and docs. The full routing engine and translation layer are in the private `zippymesh-dist` repository and distributed as the prebuilt product. See [`docs/OPEN_CORE_MANIFEST.md`](docs/OPEN_CORE_MANIFEST.md) for the exact split.

---

## Community build

The community build strips proprietary routing internals and replaces them with open stubs:

```bash
npm run build:community
```

Output in `community-dist/`. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

---

## MCP server

ZMLR includes an MCP (Model Context Protocol) server for AI agents, over two transports.

**stdio** — for Claude Code, Cursor, Kilo, Cline and anything else that launches an MCP subprocess. No build and no running server needed:

```bash
claude mcp add zmlr -e DATA_DIR="$HOME/.zippy-mesh" -e ZIPPYVAULT_TOKEN=... \
  -- node /absolute/path/to/ZippyMesh_LLM_Router/scripts/mcp-stdio.mjs
```

See **[`docs/MCP_STDIO.md`](docs/MCP_STDIO.md)** for the Cursor / Kilo config snippets, the environment variables, and the vault unlock-scope note (`vault_get` needs `ZMLR_URL` pointed at a running ZMLR server).

**HTTP** — when ZMLR is already running and your client can POST to a URL:

```json
{
  "mcpServers": {
    "zmlr": {
      "url": "http://localhost:20128/mcp"
    }
  }
}
```

Tools (identical on both transports): `list_models`, `recommend_model`, `validate_model`, `get_models_by_capability`, `get_routing_metadata`, `execute_with_routing`, and the ZippyVault tools `vault_status`, `vault_list`, `vault_get`, `vault_store`.

The vault tools never run on the router key alone. `vault_list`, `vault_get` and `vault_store` require a **scoped ZippyVault agent token** (issue one with `POST /api/vault/tokens`); the token's scopes bound what the agent can see, and every access is logged.

- Over HTTP (`/api/mcp`): send the token per request as `x-zippyvault-token: <token>` (or `Authorization: Bearer <token>` when that header is not carrying your router API key).
- Over stdio (`scripts/mcp-stdio.mjs`): set `ZIPPYVAULT_TOKEN=<token>` in that process's environment — in your MCP client's `env` block.

`vault_list` works on a locked vault (metadata only, with an `unlocked` flag); `vault_get` needs the vault unlocked; `vault_store` needs a token scoped to `*` and an unlocked vault. `vault_status` needs no token and returns no secret material.

---

## ZippyCoin / P2P mesh

Wallet, network, and node monetization features are **early alpha / testnet only**. ZMLR works fully without them. See the [Early Alpha banner](#) in the dashboard for details.

---

## License

**Source-Available — Zippy Technologies Source-Available Commercial Install License v1.1**

- **Personal and educational use:** free
- **Commercial use:** USD $1,000 per install
- **Derivative works:** must be disclosed to Zippy Technologies LLC

See [LICENSE](LICENSE) for full terms.
Commercial licensing: **Support@GoZippy.com**

---

## Support

- **Website:** [zippymesh.com](https://zippymesh.com)
- **Issues:** [github.com/GoZippy/zippymesh-router/issues](https://github.com/GoZippy/zippymesh-router/issues)
- **Email:** Support@GoZippy.com

---

*ZippyMesh LLM Router — © 2026 Zippy Technologies LLC. All rights reserved.*
