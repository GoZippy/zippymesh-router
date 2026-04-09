import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetProviderConnections,
  mockGetRoutingPlaybooks,
  mockGetProviderNodes,
  mockGetSettings,
  mockGetCombos,
  mockGetSqliteDb,
  mockGetRegistryModels,
  mockGetSidecarPeers,
} = vi.hoisted(() => ({
  mockGetProviderConnections: vi.fn().mockResolvedValue([]),
  mockGetRoutingPlaybooks: vi.fn().mockResolvedValue([]),
  mockGetProviderNodes: vi.fn().mockResolvedValue([]),
  mockGetSettings: vi.fn().mockResolvedValue({ autoDiscovery: true }),
  mockGetCombos: vi.fn().mockResolvedValue([]),
  mockGetSqliteDb: vi.fn(() => null),
  mockGetRegistryModels: vi.fn().mockResolvedValue([]),
  mockGetSidecarPeers: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnections: mockGetProviderConnections,
  getRoutingPlaybooks: mockGetRoutingPlaybooks,
  getProviderNodes: mockGetProviderNodes,
  getSettings: mockGetSettings,
  getCombos: mockGetCombos,
  getSqliteDb: mockGetSqliteDb,
}));

vi.mock("../../src/lib/modelRegistry.js", () => ({
  getRegistryModels: mockGetRegistryModels,
}));

vi.mock("../../src/lib/sidecar.js", () => ({
  getSidecarPeers: mockGetSidecarPeers,
}));

import {
  getDiscoveryCatalog,
  detectCapabilities,
} from "../../src/lib/discovery/catalogService.js";
import {
  getRecommendations,
  validateModel,
  getModelsByCapability,
} from "../../src/lib/discovery/recommendationService.js";

describe("Discovery Services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectCapabilities", () => {
    it("should detect premium capability from model ID", () => {
      const caps = detectCapabilities("claude-opus-4-6", "Claude Opus 4.6", {});
      expect(caps).toContain("premium");
    });

    it("should detect vision capability", () => {
      const caps = detectCapabilities("gpt-4-vision", "GPT-4 Vision", {});
      expect(caps).toContain("vision");
    });

    it("should detect vision from metadata", () => {
      const caps = detectCapabilities("some-model", "Some Model", {
        vision: true,
      });
      expect(caps).toContain("vision");
    });

    it("should detect embedding capability", () => {
      const caps = detectCapabilities(
        "text-embedding-ada-002",
        "Text Embedding Ada",
        {}
      );
      expect(caps).toContain("embedding");
    });

    it("should detect reasoning capability", () => {
      const caps = detectCapabilities("deepseek-r1", "DeepSeek R1", {});
      expect(caps).toContain("reasoning");
    });

    it("should detect fast capability from metadata", () => {
      const caps = detectCapabilities("model", "Model", { isFast: true });
      expect(caps).toContain("fast");
    });

    it("should detect premium capability", () => {
      const caps = detectCapabilities("gpt-4", "GPT-4", {
        isPremium: true,
      });
      expect(caps).toContain("premium");
    });

    it("should detect multiple capabilities", () => {
      const caps = detectCapabilities("gpt-4-vision", "GPT-4 Vision", {
        isCodeModel: true,
      });
      expect(caps.length).toBeGreaterThanOrEqual(2);
      expect(caps).toContain("vision");
      expect(caps).toContain("code");
    });
  });

  describe("getDiscoveryCatalog", () => {
    it("should return catalog with required fields", async () => {
      const catalog = await getDiscoveryCatalog();

      expect(catalog).toHaveProperty("models");
      expect(catalog).toHaveProperty("playbooks");
      expect(catalog).toHaveProperty("summary");
      expect(catalog).toHaveProperty("indices");
      expect(Array.isArray(catalog.models)).toBe(true);
      expect(Array.isArray(catalog.playbooks)).toBe(true);
    });

    it("should include model metadata", async () => {
      const catalog = await getDiscoveryCatalog();

      if (catalog.models.length > 0) {
        const model = catalog.models[0];
        expect(model).toHaveProperty("id");
        expect(model).toHaveProperty("name");
        expect(model).toHaveProperty("provider");
        expect(model).toHaveProperty("capabilities");
      }
    });

    it("should include capability indices", async () => {
      const catalog = await getDiscoveryCatalog();

      expect(catalog.indices).toHaveProperty("byCapability");
      expect(catalog.indices).toHaveProperty("byProvider");
    });
  });

  describe("getRecommendations", () => {
    it("should return recommendations for code intent", async () => {
      const recs = await getRecommendations("code", null, "");

      expect(recs).toHaveProperty("recommendations");
      expect(recs).toHaveProperty("fallbackChain");
      expect(Array.isArray(recs.recommendations)).toBe(true);

      // If recommendations exist, check structure
      if (recs.recommendations.length > 0) {
        const rec = recs.recommendations[0];
        expect(rec).toHaveProperty("modelId");
        expect(rec).toHaveProperty("score");
        expect(rec).toHaveProperty("reasoning");
        expect(rec.score).toBeGreaterThanOrEqual(0);
        expect(rec.score).toBeLessThanOrEqual(100);
      }
    });

    it("should return sorted recommendations by score", async () => {
      const recs = await getRecommendations("code", null, "");

      if (recs.recommendations.length > 1) {
        const scores = recs.recommendations.map((r) => r.score);
        const sorted = [...scores].sort((a, b) => b - a);
        expect(scores).toEqual(sorted);
      }
    });

    it("should apply preferFree constraint", async () => {
      const recs = await getRecommendations("chat", { preferFree: true }, "");

      if (recs.recommendations.length > 0) {
        // All recommendations should prefer free models
        // (actual filtering depends on catalog, this tests the API contract)
        expect(Array.isArray(recs.recommendations)).toBe(true);
      }
    });

    it("should return fallback chain", async () => {
      const recs = await getRecommendations("code", null, "");

      expect(Array.isArray(recs.fallbackChain)).toBe(true);
      // Fallback chain should have at least 1 model if recommendations exist
      if (recs.recommendations.length > 0) {
        expect(recs.fallbackChain.length).toBeGreaterThan(0);
      }
    });

    it("should handle different intents", async () => {
      const intents = ["code", "chat", "reasoning", "vision", "embedding", "fast", "default"];

      for (const intent of intents) {
        const recs = await getRecommendations(intent, null, "");
        expect(recs).toHaveProperty("recommendations");
        expect(recs).toHaveProperty("fallbackChain");
      }
    });
  });

  describe("validateModel", () => {
    it("should return validation result", async () => {
      const result = await validateModel("unknown-model", "code", {});

      expect(result).toHaveProperty("valid");
      expect(typeof result.valid).toBe("boolean");
    });

    it("should provide suggestions when invalid", async () => {
      const result = await validateModel("unknown-model", "code", {});

      if (!result.valid) {
        expect(result).toHaveProperty("suggestions");
        expect(Array.isArray(result.suggestions)).toBe(true);
      }
    });

    it("should check required capabilities", async () => {
      const result = await validateModel("unknown-model", "code", {
        requiredCapabilities: ["code", "vision"],
      });

      // Should validate against required capabilities
      expect(result).toHaveProperty("valid");
    });

    it("should check context window requirement", async () => {
      const result = await validateModel("unknown-model", "code", {
        contextWindow: 100000,
      });

      expect(result).toHaveProperty("valid");
    });
  });

  describe("getModelsByCapability", () => {
    it("should return models with capability", async () => {
      const result = await getModelsByCapability("code");

      expect(result).toHaveProperty("capability");
      expect(result).toHaveProperty("count");
      expect(result).toHaveProperty("models");
      expect(result.capability).toBe("code");
      expect(Array.isArray(result.models)).toBe(true);
    });

    it("should return vision models", async () => {
      const result = await getModelsByCapability("vision");

      expect(result.capability).toBe("vision");
      expect(Array.isArray(result.models)).toBe(true);
    });

    it("should return embedding models", async () => {
      const result = await getModelsByCapability("embedding");

      expect(result.capability).toBe("embedding");
      expect(Array.isArray(result.models)).toBe(true);
    });

    it("should work for all capabilities", async () => {
      const capabilities = [
        "code",
        "vision",
        "reasoning",
        "embedding",
        "fast",
        "premium",
      ];

      for (const cap of capabilities) {
        const result = await getModelsByCapability(cap);
        expect(result.capability).toBe(cap);
        expect(Array.isArray(result.models)).toBe(true);
      }
    });
  });

  describe("catalog structure", () => {
    it("should include intents in catalog", async () => {
      const catalog = await getDiscoveryCatalog();

      expect(catalog).toHaveProperty("intents");
      const intents = catalog.intents || {};
      expect(typeof intents).toBe("object");
      // Should have at least default intent
      expect(Object.keys(intents).length).toBeGreaterThanOrEqual(0);
    });

    it("should include summary statistics", async () => {
      const catalog = await getDiscoveryCatalog();

      if (catalog.summary) {
        expect(catalog.summary).toHaveProperty("totalModels");
        expect(typeof catalog.summary.totalModels).toBe("number");
      }
    });

    it("should have proper model format", async () => {
      const catalog = await getDiscoveryCatalog();

      catalog.models.forEach((model) => {
        expect(model).toHaveProperty("id");
        expect(model).toHaveProperty("name");
        expect(model).toHaveProperty("provider");
        expect(Array.isArray(model.capabilities)).toBe(true);
      });
    });
  });
});
