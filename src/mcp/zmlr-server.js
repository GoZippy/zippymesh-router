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
  },

  /**
   * Lifecycle Hooks
   */
  hooks: {
    /**
     * On server initialization
     */
    onInit: async () => {
      console.log("[ZMLR MCP] Server initializing...");
      try {
        const catalog = await getDiscoveryCatalog();
        console.log(
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
      console.log(`[ZMLR MCP] Executing tool: ${toolName}`);
      if (process.env.ZMLR_MCP_DEBUG) {
        console.log(`[ZMLR MCP] Input:`, input);
      }
    },

    /**
     * After tool execution
     */
    afterToolCall: async (toolName, input, result) => {
      if (!result.success) {
        console.warn(`[ZMLR MCP] Tool failed: ${toolName}`, result.error);
      }
      if (process.env.ZMLR_MCP_DEBUG) {
        console.log(`[ZMLR MCP] Result:`, result);
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
 * Helper to initialize the MCP server with OpenClaw
 */
export async function initializeZMLRMCPServer() {
  console.log("[ZMLR MCP] Initializing MCP server...");

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
