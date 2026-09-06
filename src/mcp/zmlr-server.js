/**
 * ZMLR MCP Server for OpenClaw Integration
 *
 * Provides Model Context Protocol server for OpenClaw agents to:
 * - Discover available models from ZMLR
 * - Get intelligent recommendations
 * - Execute requests with smart routing
 * - Track routing metrics
 *
 * Implements the Model Context Protocol (MCP)
 * See: https://modelcontextprotocol.io/
 */

import {
  getDiscoveryCatalog,
  detectCapabilities,
} from "@/lib/discovery/catalogService.js";
import {
  getRecommendations,
  validateModel,
  getModelsByCapability,
} from "@/lib/discovery/recommendationService.js";
import { isVaultUnlocked, listVaultEntries } from "@/lib/vault.js";
import {
  readVaultEntryWithToken,
  listVaultEntriesWithToken,
  storeVaultEntryWithToken,
} from "@/lib/vaultTokens.js";

// ── ZippyVault agent token for the vault_* tools ──────────────────────────────
//
// The vault tools never run on the router key alone: every read, list or
// write is authorised by a scoped ZippyVault agent token (POST
// /api/vault/tokens), so the token's scopes bound what an MCP caller can see
// and every access lands in vault_token_usage. Where the token comes from
// depends on the transport:
//   - HTTP (/api/mcp): the route passes `context.vaultToken` from the request
//     headers (VAULT_TOKEN_HEADER, or a non-router-key bearer). The
//     environment is deliberately NOT consulted for HTTP callers — a router-key
//     holder must not ride on a token that happens to sit in the server env.
//   - stdio / in-process (no context): ZIPPYVAULT_TOKEN in the process env.

/** Request header carrying the agent token over HTTP. */
export const VAULT_TOKEN_HEADER = "x-zippyvault-token";
/** Environment variable carrying the agent token for a stdio / in-process server. */
export const VAULT_TOKEN_ENV = "ZIPPYVAULT_TOKEN";

function vaultTokenFrom(context) {
  if (context && Object.prototype.hasOwnProperty.call(context, "vaultToken")) {
    return {
      token: context.vaultToken || null,
      missing:
        "ZippyVault agent token required: send it in the " +
        `'${VAULT_TOKEN_HEADER}' header (or as 'Authorization: Bearer <token>'). ` +
        "Issue one with POST /api/vault/tokens.",
    };
  }
  return {
    token: process.env[VAULT_TOKEN_ENV] || null,
    missing:
      `ZippyVault agent token required: set ${VAULT_TOKEN_ENV} in the MCP server's ` +
      "environment. Issue one with POST /api/vault/tokens.",
  };
}

/** Shape a vaultTokens failure for MCP callers, flagging what would fix it. */
function vaultFailure(result) {
  return {
    success: false,
    error: result.error,
    ...(result.code === "unauthorized" && { requires_token: true }),
    ...(result.code === "locked" && { requires_unlock: true }),
  };
}

/**
 * Field names whose VALUES are secret material and must never be written to a
 * debug log. `ZMLR_MCP_DEBUG` prints tool inputs and results to stderr, and MCP
 * hosts persist stderr to disk (H-13) — a `vault_get` result carries the
 * plaintext value, a `vault_store` input carries the secret being stored, and
 * an agent token can appear as `token`. Matched on the whole key,
 * case-insensitively.
 */
const DEBUG_SECRET_KEY =
  /^(value|secret|token|password|passphrase|api[_-]?key|apikey|private[_-]?key|credential|authorization|auth|cookie)$/i;

/**
 * Deep-redact secret-shaped fields for `ZMLR_MCP_DEBUG` logging. Non-secret
 * fields (name, label, category, unlocked, scopes, error, …) are preserved so
 * debug output stays useful; only a value under a secret-shaped key becomes
 * `"[redacted]"`. Returns a redacted COPY — the real object is untouched.
 */
export function redactForDebug(data, _seen = new WeakSet()) {
  if (Array.isArray(data)) return data.map((v) => redactForDebug(v, _seen));
  if (data && typeof data === "object") {
    if (_seen.has(data)) return "[circular]";
    _seen.add(data);
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] = DEBUG_SECRET_KEY.test(k) ? "[redacted]" : redactForDebug(v, _seen);
    }
    return out;
  }
  return data;
}

/**
 * MCP Server Definition for ZMLR
 *
 * Exposes ZMLR capabilities as MCP tools that OpenClaw agents can call
 */
export const zmlrMCPServer = {
  name: "zmlr",
  version: "1.0.0",
  description: "ZippyMesh LLM Router - Model discovery and intelligent routing",

  /**
   * Tool Definitions
   * Each tool is callable by OpenClaw agents
   */
  tools: [
    {
      name: "list_models",
      description:
        "List all available LLM models from ZMLR with filtering options",
      inputSchema: {
        type: "object",
        properties: {
          filter: {
            type: "object",
            description: "Filter options",
            properties: {
              capability: {
                type: "string",
                enum: ["code", "vision", "reasoning", "embedding", "fast", "premium"],
                description: "Filter by capability",
              },
              source: {
                type: "string",
                enum: ["cloud", "local", "p2p", "static", "registry"],
                description: "Filter by model source",
              },
              free_only: {
                type: "boolean",
                description: "Only show free models",
              },
              local_only: {
                type: "boolean",
                description: "Only show local models",
              },
            },
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default: 50)",
            default: 50,
          },
        },
      },
    },

    {
      name: "recommend_model",
      description:
        "Get intelligent model recommendations for a specific task",
      inputSchema: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            enum: ["code", "chat", "reasoning", "vision", "embedding", "fast", "default"],
            description: "Task intent/type",
            required: true,
          },
          context: {
            type: "string",
            description: "Task description or context",
          },
          constraints: {
            type: "object",
            description: "Optional constraints",
            properties: {
              max_latency_ms: {
                type: "number",
                description: "Maximum acceptable latency in milliseconds",
              },
              max_cost_per_m_tokens: {
                type: "number",
                description: "Maximum cost per 1M tokens in USD",
              },
              min_context_window: {
                type: "number",
                description: "Minimum required context window",
              },
              prefer_free: {
                type: "boolean",
                description: "Prefer free models",
              },
              prefer_local: {
                type: "boolean",
                description: "Prefer local models",
              },
            },
          },
        },
        required: ["intent"],
      },
    },

    {
      name: "validate_model",
      description: "Validate if a model meets specific requirements",
      inputSchema: {
        type: "object",
        properties: {
          model_id: {
            type: "string",
            description: "Model ID to validate",
            required: true,
          },
          intent: {
            type: "string",
            description: "Task intent for context",
          },
          requirements: {
            type: "object",
            description: "Requirements to check",
            properties: {
              required_capabilities: {
                type: "array",
                items: { type: "string" },
                description: "Required capabilities",
              },
              min_context_window: {
                type: "number",
                description: "Minimum context window",
              },
              max_cost_per_m_tokens: {
                type: "number",
                description: "Maximum cost",
              },
            },
          },
        },
        required: ["model_id"],
      },
    },

    {
      name: "get_models_by_capability",
      description: "Get all models that support a specific capability",
      inputSchema: {
        type: "object",
        properties: {
          capability: {
            type: "string",
            description: "Capability to search for",
            enum: ["code", "vision", "reasoning", "embedding", "fast", "premium"],
            required: true,
          },
          limit: {
            type: "number",
            description: "Maximum results",
            default: 20,
          },
        },
        required: ["capability"],
      },
    },

    {
      name: "get_routing_metadata",
      description: "Get routing and capability metadata about a model",
      inputSchema: {
        type: "object",
        properties: {
          model_id: {
            type: "string",
            description: "Model ID",
            required: true,
          },
        },
        required: ["model_id"],
      },
    },

    {
      name: "execute_with_routing",
      // Declared mutating: the tool is CONTRACTED to execute a request against a
      // provider (spending the operator's credits) even though today's handler
      // stops at the routing decision. Transports gate on this flag, not on the
      // current implementation, so filling in the execution step later cannot
      // silently widen who may spend money. See MUTATING_TOOLS below.
      mutating: true,
      description:
        "Execute a request with intelligent model selection and failover",
      inputSchema: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            description: "Task intent",
            enum: ["code", "chat", "reasoning", "vision", "embedding", "fast", "default"],
            required: true,
          },
          task: {
            type: "string",
            description: "Task description or prompt",
            required: true,
          },
          model_preference: {
            type: "string",
            description: "Preferred model ID (optional)",
          },
          constraints: {
            type: "object",
            description: "Task constraints",
          },
          max_retries: {
            type: "number",
            description: "Maximum fallback attempts",
            default: 3,
          },
        },
        required: ["intent", "task"],
      },
    },

    // ── ZippyVault tools ──────────────────────────────────────────────────────

    {
      name: "vault_status",
      description: "Check whether ZippyVault is unlocked and how many entries it holds",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },

    {
      name: "vault_list",
      description: "List the vault entries the caller's ZippyVault agent token is scoped to (metadata only, no values). Works on a locked vault; `unlocked` says whether vault_get would succeed. Requires an agent token.",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Optional: filter by category (e.g. 'api-key', 'password', 'token')",
          },
        },
      },
    },

    {
      name: "vault_get",
      description: "Read the decrypted value of an in-scope vault entry by name. Requires a ZippyVault agent token scoped to the entry (or '*') and an unlocked vault; every read is logged.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Exact entry name (e.g. 'TELEGRAM_BOT_TOKEN')",
          },
        },
        required: ["name"],
      },
    },

    {
      name: "vault_store",
      description: "Create or update a vault entry with an encrypted value. Requires a ZippyVault agent token scoped to '*' and an unlocked vault.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Entry identifier key (e.g. 'OPENAI_API_KEY')",
          },
          value: {
            type: "string",
            description: "Plaintext secret value to encrypt and store",
          },
          label: {
            type: "string",
            description: "Human-readable label",
          },
          category: {
            type: "string",
            description: "Category: 'api-key' | 'password' | 'token' | 'other'",
            default: "api-key",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags for filtering",
          },
        },
        required: ["name", "value"],
      },
    },
  ],

  /**
   * Tool Handlers
   * Each tool handler processes tool invocations from agents
   */
  handlers: {
    list_models: async (input) => {
      try {
        const catalog = await getDiscoveryCatalog();
        let models = catalog.models;

        // Apply filters
        if (input.filter?.capability) {
          models = models.filter(m =>
            m.capabilities.includes(input.filter.capability)
          );
        }

        if (input.filter?.source) {
          models = models.filter(m => m.source === input.filter.source);
        }

        if (input.filter?.free_only) {
          models = models.filter(m => m.isFree);
        }

        if (input.filter?.local_only) {
          models = models.filter(m => m.local);
        }

        // Apply limit
        const limit = input.limit || 50;
        models = models.slice(0, limit);

        return {
          success: true,
          count: models.length,
          models: models.map(m => ({
            id: m.id,
            name: m.name,
            provider: m.provider,
            capabilities: m.capabilities,
            isFree: m.isFree,
            local: m.local,
            inputPrice: m.inputPrice,
            contextWindow: m.contextWindow,
          })),
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    },

    recommend_model: async (input) => {
      try {
        const recommendations = await getRecommendations(input.intent, {
          maxLatencyMs: input.constraints?.max_latency_ms,
          maxCostPerMTokens: input.constraints?.max_cost_per_m_tokens,
          minContextWindow: input.constraints?.min_context_window,
          preferFree: input.constraints?.prefer_free,
          preferLocal: input.constraints?.prefer_local,
        });

        return {
          success: true,
          ...recommendations,
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    },

    validate_model: async (input) => {
      try {
        const validation = await validateModel(input.model_id, input.intent, {
          requiredCapabilities: input.requirements?.required_capabilities,
          contextWindow: input.requirements?.min_context_window,
          maxCost: input.requirements?.max_cost_per_m_tokens,
        });

        return {
          success: true,
          ...validation,
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    },

    get_models_by_capability: async (input) => {
      try {
        const result = await getModelsByCapability(input.capability);

        return {
          success: true,
          capability: result.capability,
          count: result.count,
          models: result.models.slice(0, input.limit || 20),
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    },

    get_routing_metadata: async (input) => {
      try {
        const catalog = await getDiscoveryCatalog();
        const model = catalog.models.find(m => m.id === input.model_id);

        if (!model) {
          return {
            success: false,
            error: `Model not found: ${input.model_id}`,
          };
        }

        return {
          success: true,
          model: {
            id: model.id,
            name: model.name,
            provider: model.provider,
            capabilities: model.capabilities,
            isFree: model.isFree,
            local: model.local,
            contextWindow: model.contextWindow,
            estimatedLatency: model.isFast ? 2000 : 5000,
            inputPrice: model.inputPrice,
            outputPrice: model.outputPrice,
            requiresAuth: model.requiresAuth,
            baseUrl: model.baseUrl,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    },

    execute_with_routing: async (input) => {
      try {
        // Get recommendations
        const recommendations = await getRecommendations(input.intent, {
          maxLatencyMs: input.constraints?.max_latency_ms,
          maxCostPerMTokens: input.constraints?.max_cost_per_m_tokens,
          minContextWindow: input.constraints?.min_context_window,
        });

        // Build fallback chain
        const fallbackChain = input.model_preference
          ? [input.model_preference, ...recommendations.fallbackChain]
          : recommendations.fallbackChain;

        // Return routing decision and metadata
        return {
          success: true,
          selectedModel: fallbackChain[0],
          fallbackChain: fallbackChain.slice(0, input.max_retries || 3),
          recommendations: recommendations.recommendations,
          reasoning: recommendations.recommendations[0]?.reasoning || [],
          metadata: {
            intent: input.intent,
            context: input.task,
            constraints: input.constraints,
            generatedAt: new Date().toISOString(),
          },
          nextSteps: [
            {
              instruction: "Call /v1/chat/completions with selected model",
              model: fallbackChain[0],
              header: `X-Intent: ${input.intent}`,
            },
            {
              instruction: "If rate limited, try next in fallback chain",
              models: fallbackChain.slice(1),
            },
          ],
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    },

    // ── ZippyVault handlers ───────────────────────────────────────────────────

    vault_status: async (_input) => {
      const unlocked = isVaultUnlocked();
      return {
        success: true,
        unlocked,
        entryCount: unlocked ? listVaultEntries().length : null,
      };
    },

    vault_list: async (input, context) => {
      const { token, missing } = vaultTokenFrom(context);
      if (!token) return { success: false, error: missing, requires_token: true };
      // Metadata is stored in the clear, so listing works on a locked vault;
      // `unlocked` tells the caller whether vault_get would succeed.
      const result = listVaultEntriesWithToken(token);
      if (!result.ok) return vaultFailure(result);
      let entries = result.entries;
      if (input.category) {
        entries = entries.filter(e => e.category === input.category);
      }
      return {
        success: true,
        unlocked: result.unlocked,
        scopes: result.scopes,
        count: entries.length,
        entries: entries.map(e => ({
          name: e.name,
          label: e.label,
          category: e.category,
          tags: e.tags || [],
          updated_at: e.updated_at,
        })),
      };
    },

    vault_get: async (input, context) => {
      if (!input.name || typeof input.name !== "string") {
        return { success: false, error: "name is required" };
      }
      const { token, missing } = vaultTokenFrom(context);
      if (!token) return { success: false, error: missing, requires_token: true };
      // Scope is enforced and the read is logged by readVaultEntryWithToken.
      const result = readVaultEntryWithToken(token, input.name);
      if (!result.ok) return vaultFailure(result);
      return {
        success: true,
        name: result.name,
        label: result.label,
        category: result.category,
        value: result.value,
      };
    },

    vault_store: async (input, context) => {
      const { token, missing } = vaultTokenFrom(context);
      if (!token) return { success: false, error: missing, requires_token: true };
      // Requires a token scoped to "*" and an unlocked vault.
      const result = storeVaultEntryWithToken(token, input.name, input.value, {
        label: input.label,
        category: input.category || "api-key",
        tags: input.tags,
      });
      if (!result.ok) return vaultFailure(result);
      return { success: true, name: result.name };
    },
  },

  /**
   * Lifecycle Hooks
   *
   * All diagnostics go to stderr (console.error/warn), never stdout: when this
   * module runs inside the stdio MCP transport (scripts/mcp-stdio.mjs), stdout
   * is the JSON-RPC channel and any stray line corrupts it. The stdio runner
   * also guards stdout defensively, but the library must not rely on that.
   */
  hooks: {
    /**
     * On server initialization
     */
    onInit: async () => {
      console.error("[ZMLR MCP] Server initializing...");
      try {
        const catalog = await getDiscoveryCatalog();
        console.error(
          `[ZMLR MCP] Loaded catalog: ${catalog.summary.totalModels} models, ${catalog.summary.totalPlaybooks} playbooks`
        );
      } catch (error) {
        console.error("[ZMLR MCP] Initialization error:", error);
      }
    },

    /**
     * Before tool execution
     */
    beforeToolCall: async (toolName, input) => {
      console.error(`[ZMLR MCP] Executing tool: ${toolName}`);
      // `=== "true"` (was truthy): keep all three ZMLR_MCP_DEBUG checks aligned
      // so ZMLR_MCP_DEBUG=0 no longer enables logging (H-13). Inputs are
      // redacted — vault_store's input carries the plaintext secret.
      if (process.env.ZMLR_MCP_DEBUG === "true") {
        console.error(`[ZMLR MCP] Input:`, redactForDebug(input));
      }
    },

    /**
     * After tool execution
     */
    afterToolCall: async (toolName, input, result) => {
      if (!result.success) {
        console.warn(`[ZMLR MCP] Tool failed: ${toolName}`, result.error);
      }
      // Results are redacted — a vault_get result carries the plaintext value
      // and MCP hosts persist stderr to disk (H-13).
      if (process.env.ZMLR_MCP_DEBUG === "true") {
        console.error(`[ZMLR MCP] Result:`, redactForDebug(result));
      }
    },

    /**
     * Error handling
     */
    onError: async (error, toolName) => {
      console.error(
        `[ZMLR MCP] Error in tool ${toolName}:`,
        error.message
      );
    },
  },

  /**
   * Configuration
   */
  config: {
    debug: process.env.ZMLR_MCP_DEBUG === "true",
    cacheTtlMs: 5 * 60 * 1000, // 5 minutes
    maxRecommendations: 3,
    defaultMaxRetries: 3,
  },
};

/**
 * Names of tools that mutate state, spend the operator's money, or are
 * contracted to do so. Derived from the `mutating` flag on each tool
 * definition, so the classification lives next to the tool it describes.
 *
 * A transport (currently src/app/api/mcp/route.js) must require a
 * REVOCATION-AWARE caller identity for these — a live session or a router API
 * key checked against the database — because the edge middleware can only
 * verify a key's HMAC, never whether it has since been revoked.
 *
 * The `vault_*` tools are deliberately NOT in this set even though `vault_store`
 * writes: they carry a strictly stronger gate of their own (a scoped, revocable
 * ZippyVault agent token, enforced inside each handler), and a router key never
 * substitutes for it. Adding them here would only layer a weaker check on top.
 *
 * @type {Set<string>}
 */
export const MUTATING_TOOLS = new Set(
  (zmlrMCPServer.tools || [])
    .filter(t => t?.mutating && !String(t.name).startsWith("vault_"))
    .map(t => t.name)
);

/** True when `name` names a tool that requires a revocation-aware caller. */
export function isMutatingTool(name) {
  return MUTATING_TOOLS.has(name);
}

/**
 * Helper to initialize the MCP server with OpenClaw
 */
export async function initializeZMLRMCPServer() {
  console.error("[ZMLR MCP] Initializing MCP server...");

  if (zmlrMCPServer.hooks?.onInit) {
    await zmlrMCPServer.hooks.onInit();
  }

  return {
    server: zmlrMCPServer,
    isReady: true,
    message: "ZMLR MCP Server ready for OpenClaw",
  };
}

/**
 * Export tool implementations for testing
 */
export const handlers = zmlrMCPServer.handlers;
