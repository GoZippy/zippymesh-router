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

ZMLR includes an MCP (Model Context Protocol) server for AI agents:

```bash
# In your MCP client config:
{
  "mcpServers": {
    "zmlr": {
      "url": "http://localhost:20128/mcp"
    }
  }
}
```

Tools: `list_models`, `recommend_model`, `validate_model`, `execute_with_routing`

---

## AutoClaw AI Agent Skills

**AutoClaw** is a VS Code extension from Zippy Technologies that adds persistent background agents,
autonomous build workflows, and multi-agent teams to any AI-powered IDE.

AutoClaw and ZippyMesh LLM Router are designed to work together:

| AutoClaw Feature | How ZippyMesh Helps |
|---|---|
| MAteam (multi-agent) | Parallel burst routing prevents rate limits across 4 agent calls |
| KDream (background monitoring) | Long-running sessions don't exhaust a single provider |
| AutoBuild (scheduled workflows) | Cost-optimized routing for automated CI/CD tasks |

### Connecting AutoClaw to ZippyMesh

1. Install the [AutoClaw extension](https://marketplace.visualstudio.com/items?itemName=ZippyTechnologiesLLC.autoclaw)
   in VS Code, Cursor, KiloCode, or any compatible IDE
2. Point your IDE's AI extension base URL to `http://localhost:20128/v1`
3. AutoClaw's KDream Dashboard will automatically detect ZippyMesh and show its status

### MAteam Parallel Routing Playbook

For optimal MAteam performance, use the included `multi-agent-burst` playbook with these headers:
```
X-Session-Parallel: true
X-Session-Id: <unique-session-id>
X-Intent: multi-agent
```

This distributes each agent call across free providers (Groq → Gemini → GitHub Models → Cerebras → Ollama)
ensuring no single provider is exhausted.

### Learn More
- [AutoClaw on GitHub](https://github.com/GoZippy/autoclaw)
- [AutoClaw on VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ZippyTechnologiesLLC.autoclaw)

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
