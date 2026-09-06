# ZMLR as an MCP server (stdio)

ZMLR ships an MCP server that speaks the **stdio transport**, so Claude Code,
Cursor, Kilo, Cline and anything else that launches an MCP subprocess can use
ZMLR's model-discovery and ZippyVault tools directly.

```bash
node scripts/mcp-stdio.mjs
```

No flags, no build step, no running web server required. Node 20.6+ (the
project targets Node 22+).

> **Not the same as `/api/mcp`.** The HTTP route exposes the same tools to
> clients that can POST to a URL. This page is about the subprocess transport,
> which is what most editor integrations actually want.

---

## Quick start

### Claude Code

```bash
claude mcp add zmlr \
  -e DATA_DIR="$HOME/.zippy-mesh" \
  -e ZIPPYVAULT_TOKEN=YOUR_AGENT_TOKEN \
  -- node /absolute/path/to/ZippyMesh_LLM_Router/scripts/mcp-stdio.mjs
```

On Windows (PowerShell), use the Windows data dir and an absolute path:

```powershell
claude mcp add zmlr `
  -e DATA_DIR="$env:APPDATA\zippy-mesh" `
  -e ZIPPYVAULT_TOKEN=YOUR_AGENT_TOKEN `
  -- node C:\path\to\ZippyMesh_LLM_Router\scripts\mcp-stdio.mjs
```

`--` separates Claude Code's own flags from the command it will spawn;
everything after it is the subprocess. Add `-s user` to register the server for
every project instead of just the current one. Verify with `claude mcp list`.

### Cursor — `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "zmlr": {
      "command": "node",
      "args": ["/absolute/path/to/ZippyMesh_LLM_Router/scripts/mcp-stdio.mjs"],
      "env": {
        "DATA_DIR": "/Users/you/.zippy-mesh",
        "ZIPPYVAULT_TOKEN": "YOUR_AGENT_TOKEN"
      }
    }
  }
}
```

### Kilo Code / Cline — `mcp_settings.json`

```json
{
  "mcpServers": {
    "zmlr": {
      "command": "node",
      "args": ["/absolute/path/to/ZippyMesh_LLM_Router/scripts/mcp-stdio.mjs"],
      "env": {
        "DATA_DIR": "/Users/you/.zippy-mesh",
        "ZIPPYVAULT_TOKEN": "YOUR_AGENT_TOKEN"
      },
      "disabled": false
    }
  }
}
```

Windows JSON needs escaped backslashes: `"C:\\Users\\you\\AppData\\Roaming\\zippy-mesh"`.

---

## Environment

| Variable | Required | What it does |
|---|---|---|
| `DATA_DIR` | recommended | The ZMLR data directory (SQLite DB + vault). **Must match the ZMLR server whose vault you expect to see.** Defaults to `%APPDATA%\zippy-mesh` on Windows, `~/.zippy-mesh` elsewhere. |
| `ZIPPYVAULT_TOKEN` | for vault tools | A scoped ZippyVault agent token. Issue one with `POST /api/vault/tokens`. Without it the `vault_*` tools return a clear `requires_token` error instead of failing. |
| `ZMLR_URL` | optional | e.g. `http://127.0.0.1:20128`. Routes the vault tools at a **running** ZMLR server — see [Vault unlock scope](#vault-unlock-scope-important) below. The token is POSTed in the request body, so a non-loopback host is refused unless `ZMLR_ALLOW_REMOTE=1` is set **and** the URL is `https://`. |
| `ZMLR_ALLOW_REMOTE` | optional | Set to `1` to allow `ZMLR_URL` to name a non-loopback host (still requires `https://`). Off by default — the token never leaves loopback otherwise. |
| `ZMLR_MCP_DEBUG` | optional | Set to `true` for verbose per-tool logging (on stderr). Vault-secret fields (`value`, tokens, passwords, …) are redacted; only `ZMLR_MCP_DEBUG=true` enables it (`0`/other values do not). |

`DATA_DIR` is not optional in spirit: with no value the server opens the
operator's real store and runs migrations against it. Point it somewhere
deliberate.

---

## Tools

`list_models`, `recommend_model`, `validate_model`, `get_models_by_capability`,
`get_routing_metadata`, `execute_with_routing`, and the ZippyVault tools
`vault_status`, `vault_list`, `vault_get`, `vault_store`.

They are the same handlers `/api/mcp` serves, so the two transports cannot
drift. The difference is authentication: over HTTP the vault token travels in
the `x-zippyvault-token` header per request; over stdio it comes from
`ZIPPYVAULT_TOKEN` in the subprocess environment, which is exactly why the
server invokes handlers with no request context.

Tools that change state or spend the operator's money — `execute_with_routing`
today — are advertised with `annotations.readOnlyHint: false`, so a client can
decline to auto-approve them. Note the posture difference: over HTTP those tools
are additionally gated on a revocation-aware caller identity, because anyone who
can reach the port might call them. Over stdio the transport *is* the boundary —
the subprocess runs as whoever launched it, with the environment that launch
gave it, so there is no second identity to check. Treat "who may spawn this
server" as the access-control decision.

- `vault_status` needs no token and returns no secret material.
- `vault_list` works on a **locked** vault (metadata only) and reports
  `unlocked` so a client can tell whether a read would succeed.
- `vault_get` needs the vault **unlocked** and a token scoped to the entry (or `*`).
- `vault_store` needs a token scoped to `*` and an unlocked vault.

---

## Vault unlock scope (important)

**By default `vault_get` over stdio will report `Vault is locked`, even though
you unlocked the vault in the ZMLR UI.** This is a real limitation, not a
misconfiguration, and it is worth understanding before you file a bug.

`src/lib/vault.js` holds the master password in a module-level variable for the
life of the process. The stdio MCP server is a **separate process** from the
ZMLR web server. Your editor launches it; it opens the same SQLite file (given
the same `DATA_DIR`) and can therefore read *metadata* — which is why
`vault_list` works — but it has its own empty unlock state and no way to obtain
the master password. There is deliberately no stdio message that unlocks the
vault: that would mean sending the master password down the transport and into
an editor's MCP config.

Observed directly (fresh `DATA_DIR`, one seeded entry, a `*`-scoped token):

```
vault_list -> {"success":true,"unlocked":false,"scopes":["*"],"count":1,
               "entries":[{"name":"STDIO_PROBE_SECRET",...}]}
vault_get  -> {"success":false,"error":"Vault is locked","requires_unlock":true}
```

### The fix: `ZMLR_URL`

Set `ZMLR_URL` to a running ZMLR server and the vault tools call **its**
token routes instead of this process's vault library:

| Tool | Route used |
|---|---|
| `vault_status` | `POST /api/vault/list-with-token` (reads its `unlocked` flag) |
| `vault_list` | `POST /api/vault/list-with-token` |
| `vault_get` | `POST /api/vault/read-with-token` |

The unlock then lives where the user actually performs it — in the ZMLR
UI — and every read still lands in `vault_token_usage` with the token's scopes
enforced. Results carry a `via` field naming the server they came from.

```bash
claude mcp add zmlr \
  -e ZMLR_URL=http://127.0.0.1:20128 \
  -e ZIPPYVAULT_TOKEN=YOUR_AGENT_TOKEN \
  -- node /absolute/path/to/ZippyMesh_LLM_Router/scripts/mcp-stdio.mjs
```

Same seeded vault, same token, with `ZMLR_URL` pointed at a server that has the
vault unlocked:

```
vault_status -> {"success":true,"unlocked":true,"entryCount":1,"scope":"token",...}
vault_get    -> {"success":true,"name":"STDIO_PROBE_SECRET","value":"<redacted>"}
```

Notes and limits:

- `DATA_DIR` no longer has to match when `ZMLR_URL` is set for the vault tools —
  the remote server owns that data — but the non-vault tools still read the
  local catalog, so keep it correct anyway.
- **`vault_store` is not proxied.** There is no `store-with-token` route and the
  two token-route contracts are frozen (an agent integration depends on them
  byte-for-byte). `vault_store` therefore always uses the local library and
  needs a vault unlocked in *this* process — in practice, it is unavailable over
  stdio. Use the ZMLR UI or `/api/mcp` to write.
- If the server is unreachable the tools say so and name `ZMLR_URL`, rather
  than throwing.

---

## How it works (and why it needed a runner)

`src/mcp/zmlr-server.js` and its dependency graph import through the `@/`
alias that `jsconfig.json` declares (`"@/*" → "./src/*"`,
`"open-sse/*" → "./open-sse/*"`). Next and Vitest resolve that; plain `node`
does not, so the server could not be launched as a process at all. That was the
whole gap.

`scripts/mcp-stdio.mjs` closes it with Node's module-customization hooks:

1. `module.register()` installs `src/mcp/stdio/loader.mjs`, whose `resolve` hook
   maps the two aliases with the same extension-optional, index-aware lookup the
   bundler performs (`@/lib/localDb` → `src/lib/localDb.js`).
2. `src/mcp/stdio/stdoutGuard.mjs` claims stdout. **stdout is the protocol
   channel** — one stray log line corrupts the stream and the client drops the
   connection. The guard redirects `process.stdout.write` and
   `console.log`/`info`/`debug` to **stderr** before the application graph
   loads, so the MCP lifecycle hooks and `localDb.js`'s migration chatter are
   safely diverted. Only framed JSON-RPC reaches stdout.
3. `src/mcp/stdio/server.mjs` runs the loop.

Nothing in `src/` had to change, and no Next-only module needed shimming.

### Protocol details

- Newline-delimited UTF-8 JSON-RPC 2.0 on stdin/stdout.
- `initialize` echoes the client's `protocolVersion` when it is one of
  `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`; otherwise it offers
  `2025-06-18`. Capabilities are `{ tools: {} }`.
- `notifications/initialized`, `notifications/cancelled` and
  `notifications/progress` are accepted silently; notifications never get a
  response.
- `ping` → `{}`.
- `tools/call` returns `{ content: [{ type: "text", text: "<handler JSON>" }],
  isError }`, where `isError` is true exactly when the handler reported
  `success: false`. A tool failure is *not* a JSON-RPC error — the client gets
  an actionable message rather than a dead request.
- JSON-RPC errors: `-32700` parse, `-32600` invalid request, `-32601` unknown
  method, `-32602` bad params or unknown tool (the error `data` lists the
  available tools), `-32603` handler threw.
- Requests are handled **concurrently**; a slow tool call never blocks a `ping`
  behind it. Responses may therefore arrive out of order, which JSON-RPC allows
  — match on `id`. Each response is written as one whole line.
- The process exits 0 when stdin closes, after in-flight calls settle.

### Using the alias loader elsewhere

Any plain-Node script can borrow it:

```bash
node --import ./src/mcp/stdio/register.mjs your-script.mjs
```

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Cannot find module '.../@/lib/...'` | You launched `src/mcp/zmlr-server.js` directly. Use `scripts/mcp-stdio.mjs`; it installs the aliases. |
| Client reports a parse error / disconnects | Something wrote to stdout. Everything ZMLR logs already goes to stderr; if you added code, check for a `process.stdout.write`. |
| `vault_get` says `Vault is locked` | Expected without `ZMLR_URL` — see [Vault unlock scope](#vault-unlock-scope-important). |
| `vault_*` says `requires_token` | `ZIPPYVAULT_TOKEN` is unset or empty in the MCP client's `env` block. |
| `vault_list` returns `count: 0` | `DATA_DIR` points at a different store than the one you populated, or the token's scopes are empty. |
| `Node 20.6+ is required` | `module.register()` is unavailable. Upgrade Node. |

To see what the server is doing, read the client's MCP log for the `zmlr`
server (stderr). It prints a banner with the tool count on startup, and
`ZMLR_MCP_DEBUG=true` adds per-call detail.

You can also drive it by hand:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | DATA_DIR=/tmp/zmlr-probe node scripts/mcp-stdio.mjs
```

---

## Tests

`tests/unit/mcpStdio.test.js` spawns the real script and drives it over a pipe,
against a throwaway `DATA_DIR`. It asserts the response shapes, the error
codes, the alias resolution, and — the regression that matters most — that
stdout contains nothing but JSON-RPC lines.

```bash
DATA_DIR=/tmp/zmlr-test npx vitest run tests/unit/mcpStdio.test.js
```
