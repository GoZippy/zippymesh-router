# Routing Playbooks

Playbooks define routing rules: which models to boost, filter, or stack for failover. They are stored in the local database and can be imported from JSON.

## Intent-Based Routing

ZMLR supports automatic intent detection from request context. When `routingMode: "auto"`, the router analyzes prompt content to select the best playbook. User agents can also explicitly set intent via:
- `context.intent` parameter in the API request
- Header-based intent: `X-ZippyMesh-Intent: code`
- Model alias prefix: `zippymesh/code-focus/gpt-4o`

## Example Playbooks

High-level intent profiles supported by the router:

| Intent | Focus | Typical model families |
|--------|-------|--------------------|
| `code` | High quality coding responses | Claude, DeepSeek, Gemini Coder |
| `fast_code` | Low-latency coding + edits | Groq, Cerebras, local runtimes |
| `architect` | Systems design and architecture | Claude Opus, GPT-5, Gemini Pro |
| `debug` | Troubleshooting and root-cause analysis | Claude, DeepSeek, GPT-4 |
| `review` | Auditing and code review | GPT-4/Claude/Gemini |
| `local` / `free_*` | Data-sensitive or budget-first paths | Ollama, LMStudio, Groq, Cerebras |

For concrete JSON examples, use the rule-by-rule schema in [docs/PLAYBOOK_GUIDE.md](PLAYBOOK_GUIDE.md)
and import through the dashboard/API after your first provider setup.

If you need pre-built starter templates, use the examples in your private
operations notes until they are reintroduced into this repository.

## Agent Intent Integration

User agents (like Kilo Code, OpenClaw, Cursor) can signal intent to ZMLR for smart routing:

### Method 1: API Context
```json
POST /v1/chat/completions
{
  "model": "auto",
  "messages": [...],
  "context": {
    "intent": "code",
    "clientId": "kilo-code-v1.2"
  }
}
```

### Method 2: Header
```
X-ZippyMesh-Intent: architect
X-ZippyMesh-Mode: premium
```

### Method 3: Model Alias
```json
{
  "model": "zippymesh/code-focus"
}
```

### Supported Intents

| Intent | Use For | Typical Models |
|--------|---------|----------------|
| `code` | Code generation, editing | Claude Sonnet, DeepSeek, Qwen-Coder |
| `fast_code` | Quick edits, simple tasks | Groq, Cerebras, local |
| `architect` | System design, planning | Claude Opus, GPT-5 |
| `ask` | Q&A, explanations | GLM, Kilo free, Groq |
| `debug` | Troubleshooting, errors | Claude, DeepSeek |
| `review` | Code review, audits | Claude, GPT-4 |
| `orchestrator` | Multi-agent, workflows | GPT-4o, Claude |
| `tool_use` | Function calling, MCP | GPT-4o, Claude |
| `document` | Long document analysis | Gemini, Claude |
| `reasoning` | Complex analysis | Claude Opus, DeepSeek-R1 |
| `generic` | General purpose | Local first, then cloud |
| `urgent` | Critical tasks | Top-tier paid only |
| `free_*` | Budget variants | Free providers only |
| `local` | Privacy mode | Ollama, LMStudio only |

## Import via API

```bash
curl -X POST http://localhost:20128/api/routing/playbooks \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"name":"zippymesh/code-focus","rules":[{"type":"boost","target":"claude-sonnet","value":80000},{"type":"filter-in","value":"openai"},{"type":"sort-by-cheapest","target":"*"}]}'
```

You must be logged in. The API creates a new playbook with a generated ID.

## Import via dashboard

If the dashboard has an "Import example playbook" option, select a file from the list or paste JSON.

## Using Playbook Models Directly

Instead of specifying a provider/model, you can request a playbook by name:

```json
POST /v1/chat/completions
{
  "model": "zippymesh/code-focus",
  "messages": [...]
}
```

The router will automatically select the best model based on the playbook's rules and your connected providers.

## Schema

Each playbook has:

- `name` (required) - Can be used as a model name (e.g., "zippymesh/code-focus")
- `description` (optional)
- `trigger` (optional) - `{ type: "intent", value: "code" }` for automatic selection
- `rules` — array of `{ type, target, value }` (e.g. `boost`, `filter-in`, `filter-out`, `stack`)
- `isActive` (default: true)
- `priority` (default: 0; higher = applied first)

### Rule Types

| Type | Description | Example |
|------|-------------|---------|
| `boost` | Lower score = higher priority | `{ "type": "boost", "target": "claude-sonnet", "value": 80000 }` |
| `penalty` | Increase score = lower priority | `{ "type": "penalty", "target": "gpt-3.5", "value": 50000 }` |
| `filter-in` | Only include matching providers | `{ "type": "filter-in", "target": "groq", "value": "groq" }` |
| `filter-out` | Exclude matching providers | `{ "type": "filter-out", "target": "openai", "value": "openai" }` |
| `sort-by-cheapest` | Prioritize by cost | `{ "type": "sort-by-cheapest", "target": "*" }` |
| `sort-by-fastest` | Prioritize by latency | `{ "type": "sort-by-fastest", "target": "*" }` |
| `stack` | Failover chain | `{ "type": "stack", "target": "anthropic,openai,groq", "value": "failover" }` |
| `cost-threshold` | Max cost per 1k tokens | `{ "type": "cost-threshold", "value": 0.01 }` |
