/**
 * Provider-node management.
 *
 * ## Route-level auth (C1a, added 2026-08-30)
 *
 * `src/middleware.js:120-129` says, in as many words, that its edge check
 * proves key AUTHENTICITY only and that "Sensitive management routes MUST add
 * their own route-level guard — do not rely on this edge check alone."
 * This route drives arbitrary outbound `fetch()` and mints routing targets, so
 * it is exactly such a route, and until this commit it had no guard at all:
 * no `requireAuth`, no `checkAuth`, no `requireApiKey`.
 *
 * Both handlers now go through `requireAuth`, which also brings the shared
 * 300/min per-peer dashboard rate limit. In `requireLogin:false` open mode
 * `checkAuth()` still returns true — that is the documented open-mode posture —
 * which is why the *second* half of the C1 fix (the host allow-list in
 * `registerLocalRuntime`, src/lib/routing/hostClass.js) is not optional.
 */

import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { createProviderNode, getProviderNodes } from "@/models";
import { OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX } from "@/shared/constants/providers";
import { generateId } from "@/shared/utils";
import { registerLocalRuntime, LOCAL_API_TYPES, resolveLocalApiType } from "@/lib/discovery/localDiscovery.js";
import { invalidateLocalModelIndex, prefixForNode, ownerNodeIdFor, baseNamespaceFor } from "@/lib/routing/localModelIndex.js";
import { requireAuth, getSessionClaims } from "@/lib/auth/middleware.js";
import { hasUserRole, USER_ROLES } from "@/lib/auth/rbac.js";
import { getSettings } from "@/lib/localDb.js";

/**
 * Does this caller hold an admin (or better) session?
 *
 * Mirrors `requireRole`'s open-mode decision exactly: with `requireLogin:false`
 * the caller is treated as superadmin, because that is the posture `checkAuth()`
 * already takes and single-user installs must not be locked out. Used only to
 * gate the `allowRemote` escalation, never to gate ordinary registration.
 */
async function hasAdminSession() {
  try {
    const settings = await getSettings();
    if (settings?.requireLogin === false) return true;
    const claims = await getSessionClaims();
    return hasUserRole(claims?.role, USER_ROLES.ADMIN);
  } catch {
    return false;
  }
}

const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
};

const ANTHROPIC_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.anthropic.com/v1",
};

/** Default endpoint per local runtime, so `{type:"local", apiType:"ollama"}`
 *  alone is enough for the common case. */
const LOCAL_DEFAULT_BASE_URLS = {
  ollama: "http://127.0.0.1:11434",
  lmstudio: "http://127.0.0.1:1234",
  llamacpp: "http://127.0.0.1:8080",
  vllm: "http://127.0.0.1:8000",
  // Same default as vLLM: LOCAL_RUNTIME_PROFILES gives it port 8000, and the
  // dashboard's "Add a local runtime" card offers it as a first-class choice.
  "openai-compatible": "http://127.0.0.1:8000",
};

// GET /api/provider-nodes - List all provider nodes
export const GET = requireAuth(async function GET(request) {
  try {
    const nodes = await getProviderNodes();
    return NextResponse.json({ nodes });
  } catch (error) {
    console.log("Error fetching provider nodes:", error);
    return apiError(request, 500, "Failed to fetch provider nodes");
  }
});

// POST /api/provider-nodes - Create provider node
export const POST = requireAuth(async function POST(request) {
  try {
    const body = await request.json();
    const { name, prefix, apiType, baseUrl, type, allowRemote } = body;

    // Determine type
    const nodeType = type || "openai-compatible";

    /* ---------------------------------------------------------------- *
     * type:"local" — register a locally hosted runtime in one call.
     *
     * Added 2026-08-30. Before this, `POST /api/provider-nodes {type:"local"}`
     * answered `400 Invalid provider node type` and the ONLY way to tell ZMLR
     * about an Ollama already running on the box was `POST /api/discovery`,
     * a sweep of every /24 of every non-internal IPv4 interface that took ~240 s
     * and registered the same runtime twice. This path probes exactly one URL
     * with a 5 s timeout and dedupes by normalized host:port.
     *
     *   POST /api/provider-nodes
     *   { "type": "local",
     *     "apiType": "ollama" | "lmstudio" | "llamacpp" | "vllm" | "openai-compatible",
     *     "baseUrl": "http://127.0.0.1:11434",   // optional, defaults per apiType
     *     "name": "Ollama" }                     // optional
     *
     *   201 { node, created:true,  models:[...], modelIds:["ollama/qwen3.5:4b", ...] }
     *   200 { node, created:false, deduped:true, ... }   already registered
     *   400 unsupported apiType / unparseable baseUrl
     *   502 nothing answered at that URL
     *
     * `createProviderNode` syncs the auto-managed provider connection, so the
     * node is a routing candidate as soon as this returns — no scan, no restart.
     * ---------------------------------------------------------------- */
    if (nodeType === "local") {
      const profileKey = resolveLocalApiType(apiType);
      if (!profileKey) {
        return apiError(request, 400, `Invalid local apiType${apiType ? ` "${apiType}"` : ""}. Use one of: ${LOCAL_API_TYPES.join(", ")}`);
      }

      const target = (typeof baseUrl === "string" && baseUrl.trim())
        ? baseUrl.trim()
        : LOCAL_DEFAULT_BASE_URLS[profileKey];
      if (!target) {
        return apiError(request, 400, `baseUrl is required for apiType "${profileKey}"`);
      }

      // `allowRemote` only unlocks a link-local or unresolvable host, and only
      // from an admin session. A public address is refused either way — see
      // src/lib/routing/hostClass.js for the whole policy.
      const wantsRemote = allowRemote === true;
      const outcome = await registerLocalRuntime({
        baseUrl: target,
        apiType: profileKey,
        name,
        prefix,
        timeoutMs: 5000,
        allowRemote: wantsRemote,
        isAdmin: wantsRemote ? await hasAdminSession() : false,
      });

      if (!outcome.ok) {
        return apiError(request, outcome.status || 400, outcome.error || "Failed to register local runtime");
      }

      // The chat path and /v1/models both read a TTL-cached view of what the
      // local runtimes serve; a brand-new node must show up immediately.
      invalidateLocalModelIndex();

      // The id namespace this node's models will actually appear under. The
      // bare `ollama/` namespace belongs to ONE node (loopback first, then
      // earliest registration); everything else is `ollama@<host-port>/`, so a
      // second runtime serving the same tag can no longer shadow the first.
      let modelPrefix;
      try {
        const all = (await getProviderNodes()) || [];
        const localNodes = all.filter((n) => n?.type === "local" && n?.baseUrl);
        const owners = ownerNodeIdFor(localNodes);
        modelPrefix = prefixForNode(outcome.node, owners.get(baseNamespaceFor(outcome.node)) ?? null);
      } catch {
        modelPrefix = prefixForNode(outcome.node);
      }

      return NextResponse.json(
        {
          node: outcome.node,
          created: outcome.created,
          deduped: !outcome.created,
          namespace: modelPrefix,
          models: outcome.models,
          modelIds: (outcome.models || []).map((m) => `${modelPrefix}/${m}`),
        },
        { status: outcome.created ? 201 : 200 }
      );
    }

    if (!name?.trim()) {
      return apiError(request, 400, "Name is required");
    }

    if (!prefix?.trim()) {
      return apiError(request, 400, "Prefix is required");
    }

    if (nodeType === "openai-compatible") {
      if (!apiType || !["chat", "responses"].includes(apiType)) {
        return apiError(request, 400, "Invalid OpenAI compatible API type");
      }

      const node = await createProviderNode({
        id: `${OPENAI_COMPATIBLE_PREFIX}${apiType}-${generateId()}`,
        type: "openai-compatible",
        prefix: prefix.trim(),
        apiType,
        baseUrl: (baseUrl || OPENAI_COMPATIBLE_DEFAULTS.baseUrl).trim(),
        name: name.trim(),
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    if (nodeType === "anthropic-compatible") {
      // Sanitize Base URL: remove trailing slash, and remove trailing /messages if user added it
      // This prevents double-appending /messages at runtime
      let sanitizedBaseUrl = (baseUrl || ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl).trim().replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/messages")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -9); // remove /messages
      }

      const node = await createProviderNode({
        id: `${ANTHROPIC_COMPATIBLE_PREFIX}${generateId()}`,
        type: "anthropic-compatible",
        prefix: prefix.trim(),
        baseUrl: sanitizedBaseUrl,
        name: name.trim(),
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    return apiError(request, 400, "Invalid provider node type");
  } catch (error) {
    console.log("Error creating provider node:", error);
    return apiError(request, 500, "Failed to create provider node");
  }
});
