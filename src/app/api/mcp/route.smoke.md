# /mcp route — smoke test

After `npm run dev` (or `npm start`) with this branch:

```bash
# GET — discovery
curl -s http://localhost:20128/mcp | jq .
# Expected:
# {
#   "success": true,
#   "server": "zmlr",
#   "version": "1.0.0",
#   "description": "ZippyMesh LLM Router - Model discovery and intelligent routing",
#   "tools": [
#     "list_models",
#     "recommend_model",
#     "validate_model",
#     "get_models_by_capability",
#     "get_routing_metadata",
#     "execute_with_routing"
#   ]
# }

# POST — list models, local-only
curl -s http://localhost:20128/mcp \
  -H 'content-type: application/json' \
  -d '{"tool":"list_models","input":{"filter":{"local_only":true},"limit":5}}' | jq .
# Expected: { "success": true, "count": <n>, "models": [...] }

# POST — recommend a model for code intent, prefer free
curl -s http://localhost:20128/mcp \
  -d '{"tool":"recommend_model","input":{"intent":"code","constraints":{"prefer_free":true}}}' | jq .
# Expected: { "success": true, "recommendations": [...], "fallbackChain": [...] }

# Bad request — missing tool
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:20128/mcp \
  -d '{"input":{}}' \
  -H 'content-type: application/json'
# Expected: 400

# Unknown tool
curl -s http://localhost:20128/mcp \
  -d '{"tool":"does_not_exist"}' \
  -H 'content-type: application/json' | jq .
# Expected: { "success": false, "error": "unknown_tool", "available": [...] } with HTTP 404
```

## What this fixes

The README and `adapters/claude-code/mcp-zippymesh.md` claim that ZMLR
exposes an MCP server at `http://localhost:20128/mcp`, but until this
PR the `zmlrMCPServer.handlers` object in `src/mcp/zmlr-server.js` had
no HTTP transport. Any client trying to register the ZMLR MCP via the
documented URL would get a 404.

## Downstream

- **AutoClaw**: `ZippyMeshProvider.recommendModel()`
  currently returns null in S1 because this route doesn't exist. Once
  this PR lands, `autoclaw llm install --zippymesh` registers
  `http://localhost:20128/mcp` in the workspace MCP config and
  AutoClaw's persona loader uses ZMLR's `recommend_model` for routing.
- **Cursor / Continue / Claude Code**: can now natively register ZMLR's
  MCP and gain `list_models` / `recommend_model` / `validate_model`
  tool surfaces without going through AutoClaw.
