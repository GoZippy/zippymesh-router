/**
 * MCP route — exposes ZMLR's `zmlrMCPServer.handlers` over HTTP.
 *
 * Closes the documented-but-unwired gap: README and the OpenClaw
 * integration guide promise `http://localhost:20128/mcp`, but until
 * this file existed the handlers in `src/mcp/zmlr-server.js` had no
 * HTTP transport. Now any MCP-aware client (AutoClaw's persona loader,
 * Cursor, Continue, Claude Code) can POST `{ tool, input }` and get
 * back the same JSON shape the handler already returns.
 *
 * Spec: docs/specs/llm-provider-s2-zmlr-mcp-route/spec.md in the
 * AutoClaw repo.
 *
 * ## Posture (decided 2026-08-30, security pass — docs/_internal/SECURITY_AUDIT_2026-08-30.md)
 *
 * Three tiers, because the callers differ in what they can prove:
 *
 * 1. **Read-only discovery** — `list_models`, `recommend_model`,
 *    `validate_model`, `get_models_by_capability`, `get_routing_metadata`,
 *    `vault_status`. Edge gate only (session cookie, or a router API key whose
 *    HMAC verifies). These read the model catalog and return no secret
 *    material, so the edge's authenticity-only check is proportionate: the
 *    worst a revoked-key holder gets is a list of models the operator already
 *    publishes at `/v1/models`.
 *
 * 2. **Mutating / executing** — anything in `MUTATING_TOOLS` (today:
 *    `execute_with_routing`). These spend the operator's provider credits, so
 *    they need to know the caller is still authorised RIGHT NOW. The edge
 *    cannot tell — `verifyBearerApiKey` checks a static HMAC and has no
 *    database, so a revoked key still passes it (see src/middleware.js). This
 *    route therefore re-checks at the route layer, where the DB is reachable:
 *    a valid dashboard session, or a router API key that `requireApiKey()`
 *    confirms is present, unrevoked, unexpired and unblacklisted.
 *
 * 3. **ZippyVault** — `vault_get`, `vault_list`, `vault_store` require a
 *    scoped ZippyVault agent token (issued at POST /api/vault/tokens) sent as
 *    `x-zippyvault-token: <token>` or `Authorization: Bearer <token>`. The
 *    router API key never unlocks vault material on its own: a bearer that is
 *    a router key (`sk-...`) is not treated as a vault token. This gate lives
 *    in the handlers and is UNCHANGED by the tiering above — vault tools are
 *    excluded from `MUTATING_TOOLS` precisely so tier 2 cannot weaken them.
 *
 * Scopes: a router key with an empty scope list is unscoped and passes tier 2,
 * matching how router-key scopes behave everywhere else in the app (nothing
 * consumes them yet, and the key-issuing UI does not offer them). A key that
 * DOES carry scopes must include `*` or `mcp` — so scoping becomes enforceable
 * the day keys start being issued with scopes, without invalidating today's.
 *
 * No rate limiting on tier 1 (handlers are cheap); tier 2 inherits the
 * per-key 100/min budget inside `requireApiKey`.
 */

import { NextResponse } from "next/server";
import { zmlrMCPServer, VAULT_TOKEN_HEADER, MUTATING_TOOLS, isMutatingTool } from "@/mcp/zmlr-server";
import { requireApiKey } from "@/lib/auth/apiKey.js";
import { checkAuth } from "@/lib/auth/middleware.js";

/** Scopes that satisfy tier 2 when a router key carries a non-empty scope list. */
const MCP_EXECUTE_SCOPES = ["*", "mcp"];

/**
 * Authorise a mutating tool call. Returns null when allowed, or a NextResponse
 * to return when not.
 *
 * Order matters: the session is checked first so a dashboard user (or an
 * install running with `requireLogin: false`, where `checkAuth()` is true by
 * design) is never asked for an API key it does not have.
 */
async function authorizeMutatingTool(req, tool) {
  if (await checkAuth()) return null;

  let scopes;
  try {
    scopes = await requireApiKey(req);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: "unauthorized",
        tool,
        detail:
          `'${tool}' mutates state or spends credits, so it needs a live caller identity: ` +
          "a dashboard session, or 'Authorization: Bearer <router API key>'. " +
          (err?.message ?? "no valid credential presented"),
      },
      { status: err?.code === 403 || err?.code === 429 ? err.code : 401 },
    );
  }

  // Unscoped keys pass (see header note). Scoped keys must opt in.
  if (Array.isArray(scopes) && scopes.length > 0 &&
      !scopes.some(s => MCP_EXECUTE_SCOPES.includes(s))) {
    return NextResponse.json(
      {
        success: false,
        error: "forbidden",
        tool,
        detail: `API key is scoped and lacks one of: ${MCP_EXECUTE_SCOPES.join(", ")}`,
      },
      { status: 403 },
    );
  }
  return null;
}

/** Map of tool name → handler function. Built once at module load. */
const HANDLERS = zmlrMCPServer.handlers || {};

/**
 * The ZippyVault agent token presented with this request, or null. The
 * explicit header wins; a bearer counts only when it is not a router API key.
 */
function vaultTokenFromHeaders(req) {
  const explicit = req.headers.get(VAULT_TOKEN_HEADER)?.trim();
  if (explicit) return explicit;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "");
  const bearer = m?.[1]?.trim();
  return bearer && !bearer.startsWith("sk-") ? bearer : null;
}

/**
 * GET /mcp — discovery endpoint. Lists tools an MCP client can call.
 *
 * `tools` stays a flat array of names (the shape existing clients parse).
 * `mutatingTools` is added alongside it so a client can tell, before it calls,
 * which names will demand a live session or router key.
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    server: zmlrMCPServer.name || "zmlr",
    version: zmlrMCPServer.version || "1",
    description: zmlrMCPServer.description || "",
    tools: Object.keys(HANDLERS),
    mutatingTools: [...MUTATING_TOOLS],
  });
}

/**
 * POST /mcp — invoke a tool.
 *
 * Body: `{ tool: string, input?: object }`
 * Response: whatever the underlying handler returns (typically
 *   `{ success: boolean, ...result }`), with HTTP status set to
 *   200 on handler success, 400 on bad request, 404 on unknown tool,
 *   500 on handler exception.
 */
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  if (!body || typeof body.tool !== "string") {
    return NextResponse.json(
      { success: false, error: "invalid_request", detail: "missing 'tool' string" },
      { status: 400 },
    );
  }

  const handler = HANDLERS[body.tool];
  if (typeof handler !== "function") {
    return NextResponse.json(
      {
        success: false,
        error: "unknown_tool",
        tool: body.tool,
        available: Object.keys(HANDLERS),
      },
      { status: 404 },
    );
  }

  // Tier 2 gate: revocation-aware identity for tools that mutate or spend.
  // Runs BEFORE the hooks so an unauthorised call is not logged as an
  // attempted invocation and cannot reach any handler side effect.
  if (isMutatingTool(body.tool)) {
    const denied = await authorizeMutatingTool(req, body.tool);
    if (denied) return denied;
  }

  // Optional: fire the existing beforeToolCall hook so existing logging
  // and debug instrumentation keeps working when called over HTTP.
  if (zmlrMCPServer.hooks?.beforeToolCall) {
    try {
      await zmlrMCPServer.hooks.beforeToolCall(body.tool, body.input ?? {});
    } catch (err) {
      console.warn("[MCP route] beforeToolCall hook threw:", err);
    }
  }

  // Handlers take (input, context). Only the vault_* tools read the context;
  // it carries the agent token (null when absent) so those tools can name
  // what is missing instead of silently falling back to the server env.
  let result;
  try {
    result = await handler(body.input ?? {}, { vaultToken: vaultTokenFromHeaders(req) });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: "internal",
        message: err?.message ?? String(err),
        tool: body.tool,
      },
      { status: 500 },
    );
  }

  if (zmlrMCPServer.hooks?.afterToolCall) {
    try {
      await zmlrMCPServer.hooks.afterToolCall(body.tool, body.input ?? {}, result);
    } catch (err) {
      console.warn("[MCP route] afterToolCall hook threw:", err);
    }
  }

  // Handler returns `{ success: boolean, ... }` per ZMLR convention.
  // Pass through verbatim; only status code differs on handler-reported failure.
  const status = result && result.success === false ? 502 : 200;
  return NextResponse.json(result, { status });
}
