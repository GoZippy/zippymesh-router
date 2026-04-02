import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetDiscoveryCatalog,
  mockDetectCapabilities,
  mockGetRecommendations,
  mockValidateModel,
  mockGetModelsByCapability,
} = vi.hoisted(() => ({
  mockGetDiscoveryCatalog: vi.fn(),
  mockDetectCapabilities: vi.fn((id) => {
    if (id.includes("embed")) return ["embedding"];
    if (id.includes("vision") || id.includes("gpt-4v")) return ["vision"];
    if (id.includes("code") || id.includes("opus")) return ["code"];
    return [];
  }),
  mockGetRecommendations: vi.fn(),
  mockValidateModel: vi.fn(),
  mockGetModelsByCapability: vi.fn(),
}));

vi.mock("../../src/lib/discovery/catalogService.js", () => ({
  getDiscoveryCatalog: mockGetDiscoveryCatalog,
  detectCapabilities: mockDetectCapabilities,
}));

vi.mock("../../src/lib/discovery/recommendationService.js", () => ({
  getRecommendations: mockGetRecommendations,
  validateModel: mockValidateModel,
  getModelsByCapability: mockGetModelsByCapability,
}));

import { zmlrMCPServer } from "../../src/mcp/zmlr-server.js";

describe("ZMLR MCP Server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list_models handler", () => {
    it("should return all models", async () => {
      const mockModels = [
        {
          id: "gpt-4o",
          name: "GPT-4o",
          provider: "openai",
          capabilities: ["code", "vision"],
          isFree: false,
          inputPrice: 0.00003,
          contextWindow: 128000,
          local: false,
        },
        {
          id: "claude-opus-4.6",
          name: "Claude Opus 4.6",
          provider: "anthropic",
          capabilities: ["code", "vision", "reasoning"],
          isFree: false,
          inputPrice: 0.000005,
          contextWindow: 200000,
          local: false,
        },
      ];

      mockGetDiscoveryCatalog.mockResolvedValue({
        models: mockModels,
      });

      const result = await zmlrMCPServer.handlers.list_models({
        limit: 50,
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.models).toHaveLength(2);
      expect(result.models[0].id).toBe("gpt-4o");
    });

    it("should filter by capability", async () => {
      mockGetDiscoveryCatalog.mockResolvedValue({
        models: [
          {
            id: "gpt-4v",
            name: "GPT-4V",
            provider: "openai",
            capabilities: ["vision"],
            isFree: false,
            inputPrice: 0.00003,
            contextWindow: 128000,
            local: false,
          },
          {
            id: "text-embedding-ada",
            name: "Text Embedding Ada",
            provider: "openai",
            capabilities: ["embedding"],
            isFree: false,
            inputPrice: 0.0001,
            contextWindow: 8192,
            local: false,
          },
        ],
      });

      const result = await zmlrMCPServer.handlers.list_models({
        filter: { capability: "vision" },
        limit: 50,
      });

      expect(result.success).toBe(true);
      expect(result.models).toHaveLength(1);
      expect(result.models[0].capabilities).toContain("vision");
    });

    it("should filter by free_only", async () => {
      mockGetDiscoveryCatalog.mockResolvedValue({
        models: [
          {
            id: "free-model",
            name: "Free Model",
            provider: "ollama",
            capabilities: ["code"],
            isFree: true,
            inputPrice: 0,
            contextWindow: 8192,
            local: true,
          },
          {
            id: "paid-model",
            name: "Paid Model",
            provider: "openai",
            capabilities: ["code"],
            isFree: false,
            inputPrice: 0.00003,
            contextWindow: 128000,
            local: false,
          },
        ],
      });

      const result = await zmlrMCPServer.handlers.list_models({
        filter: { free_only: true },
        limit: 50,
      });

      expect(result.success).toBe(true);
      expect(result.models.every((m) => m.isFree)).toBe(true);
    });
  });

  describe("recommend_model handler", () => {
    it("should return recommendations", async () => {
      mockGetRecommendations.mockResolvedValue({
        recommendations: [
          {
            rank: 1,
            modelId: "gpt-4o",
            name: "GPT-4o",
            fullModel: "openai/gpt-4o",
            score: 92,
            reasoning: ["Excellent code capabilities"],
          },
          {
            rank: 2,
            modelId: "claude-opus-4.6",
            name: "Claude Opus 4.6",
            fullModel: "anthropic/claude-opus-4.6",
            score: 88,
            reasoning: ["Good code capabilities"],
          },
        ],
        fallbackChain: ["openai/gpt-4o", "anthropic/claude-opus-4.6"],
      });

      const result = await zmlrMCPServer.handlers.recommend_model({
        intent: "code",
      });

      expect(result.success).toBe(true);
      expect(result.recommendations).toHaveLength(2);
      expect(result.recommendations[0].score).toBe(92);
    });

    it("should apply constraints", async () => {
      mockGetRecommendations.mockResolvedValue({
        recommendations: [
          {
            modelId: "fast-cheap-model",
            name: "Fast Cheap Model",
            fullModel: "provider/fast-cheap",
            score: 75,
            reasoning: [],
          },
          {
            modelId: "alt-fast",
            name: "Alt Fast",
            fullModel: "provider/alt-fast",
            score: 70,
            reasoning: [],
          },
        ],
        fallbackChain: ["provider/fast-cheap", "provider/alt-fast"],
      });

      const result = await zmlrMCPServer.handlers.recommend_model({
        intent: "fast",
        constraints: {
          max_latency_ms: 1000,
          max_cost_per_m_tokens: 0.0001,
        },
      });

      expect(result.success).toBe(true);
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations[0].score).toBe(75);
    });
  });

  describe("validate_model handler", () => {
    it("should validate existing model", async () => {
      mockValidateModel.mockResolvedValue({
        valid: true,
        reason: "Model meets all requirements",
      });

      const result = await zmlrMCPServer.handlers.validate_model({
        model_id: "gpt-4o",
      });

      expect(result.success).toBe(true);
      expect(result.valid).toBe(true);
    });

    it("should reject non-existent model", async () => {
      mockValidateModel.mockResolvedValue({
        valid: false,
        issues: ["Model not found"],
        suggestions: ["gpt-4o", "claude-opus-4.6"],
      });

      const result = await zmlrMCPServer.handlers.validate_model({
        model_id: "nonexistent-model",
      });

      expect(result.success).toBe(true);
      expect(result.valid).toBe(false);
      expect(result.suggestions).toContain("gpt-4o");
    });

    it("should validate model requirements", async () => {
      mockValidateModel.mockResolvedValue({
        valid: false,
        issues: ["Context window too small: 4096 < 100000"],
        suggestions: ["claude-opus-4.6"],
      });

      const result = await zmlrMCPServer.handlers.validate_model({
        model_id: "small-context-model",
        requirements: {
          min_context_window: 100000,
        },
      });

      expect(result.valid).toBe(false);
      expect(result.issues[0]).toContain("Context window");
    });
  });

  describe("get_models_by_capability handler", () => {
    it("should return models by capability", async () => {
      mockGetModelsByCapability.mockResolvedValue({
        capability: "vision",
        count: 3,
        models: [
          {
            id: "gpt-4v",
            name: "GPT-4V",
            provider: "openai",
            capabilities: ["vision"],
            isFree: false,
            inputPrice: 0.00003,
          },
          {
            id: "claude-opus-4.6",
            name: "Claude Opus 4.6",
            provider: "anthropic",
            capabilities: ["vision", "code"],
            isFree: false,
            inputPrice: 0.000005,
          },
          {
            id: "gemini-pro-vision",
            name: "Gemini Pro Vision",
            provider: "google",
            capabilities: ["vision"],
            isFree: false,
            inputPrice: 0.000015,
          },
        ],
      });

      const result = await zmlrMCPServer.handlers.get_models_by_capability({
        capability: "vision",
        limit: 20,
      });

      expect(result.success).toBe(true);
      expect(result.capability).toBe("vision");
      expect(result.count).toBe(3);
      expect(result.models).toHaveLength(3);
    });
  });

  describe("get_routing_metadata handler", () => {
    it("should return model metadata", async () => {
      mockGetDiscoveryCatalog.mockResolvedValue({
        models: [
          {
            id: "gpt-4o",
            name: "GPT-4o",
            provider: "openai",
            capabilities: ["code", "vision"],
            isFree: false,
            local: false,
            contextWindow: 128000,
            inputPrice: 0.00003,
            outputPrice: 0.0001,
            requiresAuth: true,
            baseUrl: "https://api.openai.com/v1",
          },
        ],
      });

      const result = await zmlrMCPServer.handlers.get_routing_metadata({
        model_id: "gpt-4o",
      });

      expect(result.success).toBe(true);
      expect(result.model.id).toBe("gpt-4o");
      expect(result.model.baseUrl).toBe("https://api.openai.com/v1");
    });

    it("should handle non-existent model", async () => {
      mockGetDiscoveryCatalog.mockResolvedValue({
        models: [],
      });

      const result = await zmlrMCPServer.handlers.get_routing_metadata({
        model_id: "nonexistent",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("execute_with_routing handler", () => {
    it("should return routing decision with fallback chain", async () => {
      mockGetRecommendations.mockResolvedValue({
        recommendations: [
          {
            modelId: "gpt-4o",
            name: "GPT-4o",
            fullModel: "openai/gpt-4o",
            score: 92,
            reasoning: ["Excellent fit"],
          },
        ],
        fallbackChain: ["openai/gpt-4o", "anthropic/claude-opus-4.6", "google/gemini"],
      });

      const result = await zmlrMCPServer.handlers.execute_with_routing({
        intent: "code",
        task: "Write a React component",
        max_retries: 3,
      });

      expect(result.success).toBe(true);
      expect(result.selectedModel).toBe("openai/gpt-4o");
      expect(result.fallbackChain).toHaveLength(3);
      expect(result.nextSteps).toBeDefined();
      expect(result.nextSteps[0].instruction).toContain("/v1/chat/completions");
    });

    it("should use model preference when provided", async () => {
      mockGetRecommendations.mockResolvedValue({
        recommendations: [
          {
            modelId: "alternative",
            fullModel: "provider/alternative",
            score: 80,
          },
        ],
        fallbackChain: ["provider/alternative"],
      });

      const result = await zmlrMCPServer.handlers.execute_with_routing({
        intent: "code",
        task: "Fix a bug",
        model_preference: "my-preferred-model",
        max_retries: 3,
      });

      expect(result.selectedModel).toBe("my-preferred-model");
      expect(result.fallbackChain[0]).toBe("my-preferred-model");
    });
  });

  describe("error handling", () => {
    it("should handle handler errors gracefully", async () => {
      mockGetDiscoveryCatalog.mockRejectedValue(
        new Error("Database connection failed")
      );

      const result = await zmlrMCPServer.handlers.list_models({});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Database connection failed");
    });
  });
});
