# ZippyMesh Plugins

Plugins extend ZippyMesh with custom providers, guardrail rules, and routing logic.

## Installation

Place your plugin directory in `~/.zippy-mesh/plugins/`:

```
~/.zippy-mesh/plugins/
  my-provider/
    index.js      ← required
    package.json  ← optional
```

Restart ZippyMesh after adding a plugin.

## Plugin Types

### Provider Plugin
Adds new LLM providers. Models appear as `plugin:[name]/[model-id]` in the catalog.

### Guardrail Plugin
Adds content filtering rules applied before each request.

### Routing-Rule Plugin
Adjusts model scoring during routing decisions.

## Reference Implementation

See `example-provider/index.js` for a complete, commented provider plugin.

## Security

**Only install plugins from sources you trust.** Plugins run in the same Node.js process as ZippyMesh and have access to the same environment variables and network resources.

Plugins must NOT:
- Import `@/lib/localDb.js` directly
- Intercept or modify response data after routing
- Access environment variables beyond what is passed in `init(config)`
