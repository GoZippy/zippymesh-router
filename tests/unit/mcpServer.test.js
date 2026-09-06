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

// Vault seams for the vault_* tools. vault_status reads the vault directly (it
// returns no secret material); vault_get / vault_list / vault_store go through
// the agent-token layer, mocked with one known-good token so scope, lock state
// and the token source (header context vs ZIPPYVAULT_TOKEN) can each be pinned.
// The plaintext lives only in readVaultEntryWithToken, so a leak is detectable.
const vaultMock = vi.hoisted(() => ({
  unlocked: true,
  isVaultUnlocked: vi.fn(() => vaultMock.unlocked),
  listVaultEntries: vi.fn(() => [
    { name: "A", label: "Alpha", category: "api-key", tags: ["t"], created_at: 1, updated_at: 2 },
    { name: "B", label: "Beta", category: "token", tags: [], created_at: 3, updated_at: 4 },
  ]),
}));
const tokensMock = vi.hoisted(() => ({
  readVaultEntryWithToken: vi.fn(),
  listVaultEntriesWithToken: vi.fn(),
  storeVaultEntryWithToken: vi.fn(),
}));

vi.mock("../../src/lib/vault.js", () => ({
  isVaultUnlocked: (...a) => vaultMock.isVaultUnlocked(...a),
  listVaultEntries: (...a) => vaultMock.listVaultEntries(...a),
}));
vi.mock("../../src/lib/vaultTokens.js", () => ({
  readVaultEntryWithToken: (...a) => tokensMock.readVaultEntryWithToken(...a),
  listVaultEntriesWithToken: (...a) => tokensMock.listVaultEntriesWithToken(...a),
  storeVaultEntryWithToken: (...a) => tokensMock.storeVaultEntryWithToken(...a),
}));

import { zmlrMCPServer, VAULT_TOKEN_HEADER, VAULT_TOKEN_ENV } from "../../src/mcp/zmlr-server.js";
import * as mcpRoute from "../../src/app/api/mcp/route.js";

const GOOD_TOKEN = "g".repeat(64);
const UNAUTHORIZED = { ok: false, error: "Invalid token", code: "unauthorized" };

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

  describe("vault tools (agent-token gated)", () => {
    const http = { vaultToken: GOOD_TOKEN };   // what /api/mcp passes for a request carrying the token
    const noToken = { vaultToken: null };      // an HTTP request without one

    beforeEach(() => {
      vaultMock.unlocked = true;
      delete process.env[VAULT_TOKEN_ENV];
      tokensMock.readVaultEntryWithToken.mockImplementation((token, name) => {
        if (token !== GOOD_TOKEN) return UNAUTHORIZED;
        if (name === "A") return { ok: true, name: "A", label: "Alpha", category: "api-key", value: "a-secret" };
        if (name === "B") return { ok: false, error: "Token is not scoped for entry 'B'. Allowed scopes: A", code: "forbidden" };
        return { ok: false, error: `Entry not found: ${name}`, code: "not_found" };
      });
      tokensMock.listVaultEntriesWithToken.mockImplementation((token) =>
        token === GOOD_TOKEN
          ? { ok: true, scopes: ["A", "C"], unlocked: vaultMock.unlocked, entries: [
              { name: "A", label: "Alpha", category: "api-key", tags: ["t"], updated_at: 2 },
              { name: "C", label: "Charlie", category: "token", tags: [], updated_at: 5 },
            ] }
          : UNAUTHORIZED
      );
      tokensMock.storeVaultEntryWithToken.mockImplementation((token) =>
        token === GOOD_TOKEN
          ? { ok: false, error: "Writing requires a token scoped to '*' (all entries)", code: "forbidden" }
          : UNAUTHORIZED
      );
    });

    it("vault_status stays open: no token needed, no secret material returned", async () => {
      expect(await zmlrMCPServer.handlers.vault_status({})).toEqual({ success: true, unlocked: true, entryCount: 2 });
      vaultMock.unlocked = false;
      expect(await zmlrMCPServer.handlers.vault_status({})).toEqual({ success: true, unlocked: false, entryCount: null });
    });

    it("without a token (no context, no ZIPPYVAULT_TOKEN) the vault tools refuse and name the env var", async () => {
      for (const [tool, input] of [["vault_list", {}], ["vault_get", { name: "A" }], ["vault_store", { name: "A", value: "v" }]]) {
        const result = await zmlrMCPServer.handlers[tool](input);
        expect(result).toMatchObject({ success: false, requires_token: true });
        expect(result.error).toContain(VAULT_TOKEN_ENV);
        expect(result).not.toHaveProperty("value");
      }
      expect(tokensMock.readVaultEntryWithToken).not.toHaveBeenCalled();
      expect(tokensMock.listVaultEntriesWithToken).not.toHaveBeenCalled();
      expect(tokensMock.storeVaultEntryWithToken).not.toHaveBeenCalled();
    });

    it("an HTTP request without a token names the header and never falls back to ZIPPYVAULT_TOKEN", async () => {
      process.env[VAULT_TOKEN_ENV] = GOOD_TOKEN;
      for (const [tool, input] of [["vault_list", {}], ["vault_get", { name: "A" }], ["vault_store", { name: "A", value: "v" }]]) {
        const result = await zmlrMCPServer.handlers[tool](input, noToken);
        expect(result).toMatchObject({ success: false, requires_token: true });
        expect(result.error).toContain(VAULT_TOKEN_HEADER);
        expect(result).not.toHaveProperty("value");
      }
      expect(tokensMock.readVaultEntryWithToken).not.toHaveBeenCalled();
    });

    it("ZIPPYVAULT_TOKEN authorises the stdio / in-process path (no context)", async () => {
      process.env[VAULT_TOKEN_ENV] = GOOD_TOKEN;
      expect(await zmlrMCPServer.handlers.vault_get({ name: "A" })).toEqual({
        success: true, name: "A", label: "Alpha", category: "api-key", value: "a-secret",
      });
      expect(tokensMock.readVaultEntryWithToken).toHaveBeenCalledWith(GOOD_TOKEN, "A");
      expect((await zmlrMCPServer.handlers.vault_list({})).success).toBe(true);
    });

    it("vault_get enforces scope through the token layer and flags what is missing", async () => {
      expect(await zmlrMCPServer.handlers.vault_get({ name: "A" }, http)).toEqual({
        success: true, name: "A", label: "Alpha", category: "api-key", value: "a-secret",
      });
      const forbidden = await zmlrMCPServer.handlers.vault_get({ name: "B" }, http);
      expect(forbidden).toEqual({ success: false, error: "Token is not scoped for entry 'B'. Allowed scopes: A" });
      expect(await zmlrMCPServer.handlers.vault_get({ name: "ZZZ" }, http)).toEqual({ success: false, error: "Entry not found: ZZZ" });
      expect(await zmlrMCPServer.handlers.vault_get({ name: "A" }, { vaultToken: "bad" })).toEqual({
        success: false, error: "Invalid token", requires_token: true,
      });
      tokensMock.readVaultEntryWithToken.mockReturnValueOnce({ ok: false, error: "Vault is locked", code: "locked" });
      expect(await zmlrMCPServer.handlers.vault_get({ name: "A" }, http)).toEqual({
        success: false, error: "Vault is locked", requires_unlock: true,
      });
    });

    it("vault_get requires a name before consulting the token", async () => {
      expect(await zmlrMCPServer.handlers.vault_get({}, http)).toEqual({ success: false, error: "name is required" });
      expect(await zmlrMCPServer.handlers.vault_get({ name: 7 }, http)).toEqual({ success: false, error: "name is required" });
      expect(tokensMock.readVaultEntryWithToken).not.toHaveBeenCalled();
    });

    it("vault_list returns in-scope metadata only, works on a locked vault, honours the category filter", async () => {
      vaultMock.unlocked = false;
      const all = await zmlrMCPServer.handlers.vault_list({}, http);
      expect(all).toEqual({
        success: true, unlocked: false, scopes: ["A", "C"], count: 2,
        entries: [
          { name: "A", label: "Alpha", category: "api-key", tags: ["t"], updated_at: 2 },
          { name: "C", label: "Charlie", category: "token", tags: [], updated_at: 5 },
        ],
      });
      expect(JSON.stringify(all)).not.toContain("a-secret");
      expect(tokensMock.listVaultEntriesWithToken).toHaveBeenCalledWith(GOOD_TOKEN);

      const tokens = await zmlrMCPServer.handlers.vault_list({ category: "token" }, http);
      expect(tokens.count).toBe(1);
      expect(tokens.entries.map((e) => e.name)).toEqual(["C"]);
    });

    it("vault_store goes through the token layer ('*' scope + unlocked vault) and forwards the entry", async () => {
      expect(await zmlrMCPServer.handlers.vault_store({ name: "N", value: "v", tags: ["x"] }, http)).toEqual({
        success: false, error: "Writing requires a token scoped to '*' (all entries)",
      });
      expect(tokensMock.storeVaultEntryWithToken).toHaveBeenCalledWith(GOOD_TOKEN, "N", "v", { label: undefined, category: "api-key", tags: ["x"] });

      tokensMock.storeVaultEntryWithToken.mockReturnValueOnce({ ok: true, name: "N" });
      expect(await zmlrMCPServer.handlers.vault_store({ name: "N", value: "v" }, http)).toEqual({ success: true, name: "N" });

      tokensMock.storeVaultEntryWithToken.mockReturnValueOnce({ ok: false, error: "Vault is locked", code: "locked" });
      expect(await zmlrMCPServer.handlers.vault_store({ name: "N", value: "v" }, http)).toEqual({
        success: false, error: "Vault is locked", requires_unlock: true,
      });
    });

    it("nothing but vault_get ever returns a value", async () => {
      tokensMock.storeVaultEntryWithToken.mockReturnValueOnce({ ok: true, name: "N" });
      for (const result of [
        await zmlrMCPServer.handlers.vault_status({}),
        await zmlrMCPServer.handlers.vault_list({}, http),
        await zmlrMCPServer.handlers.vault_store({ name: "N", value: "v" }, http),
      ]) {
        expect(result.success).toBe(true);
        expect(JSON.stringify(result)).not.toMatch(/"value"|a-secret/);
      }
    });
  });

  describe("POST /api/mcp passes the vault token from the request headers", () => {
    beforeEach(() => {
      vaultMock.unlocked = true;
      delete process.env[VAULT_TOKEN_ENV];
      tokensMock.readVaultEntryWithToken.mockImplementation((token, name) =>
        token === GOOD_TOKEN
          ? { ok: true, name, label: "Alpha", category: "api-key", value: "a-secret" }
          : UNAUTHORIZED
      );
    });

    const call = (tool, input, headers = {}) =>
      mcpRoute.POST(new Request("http://127.0.0.1:20128/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ tool, input }),
      }));

    it("x-zippyvault-token authorises vault_get", async () => {
      const res = await call("vault_get", { name: "A" }, { [VAULT_TOKEN_HEADER]: GOOD_TOKEN });
      expect(res.status).toBe(200);
      expect((await res.json()).value).toBe("a-secret");
      expect(tokensMock.readVaultEntryWithToken).toHaveBeenCalledWith(GOOD_TOKEN, "A");
    });

    it("a bearer that is not a router key is accepted as the vault token", async () => {
      const res = await call("vault_get", { name: "A" }, { authorization: `Bearer ${GOOD_TOKEN}` });
      expect(res.status).toBe(200);
      expect((await res.json()).value).toBe("a-secret");
    });

    it("a router API key bearer is NOT a vault token, and the env var is never consulted over HTTP", async () => {
      process.env[VAULT_TOKEN_ENV] = GOOD_TOKEN;
      const res = await call("vault_get", { name: "A" }, { authorization: "Bearer sk-1234567890abcdef-ab12cd-deadbeef" });
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body).toMatchObject({ success: false, requires_token: true });
      expect(body.error).toContain(VAULT_TOKEN_HEADER);
      expect(body).not.toHaveProperty("value");
      expect(tokensMock.readVaultEntryWithToken).not.toHaveBeenCalled();
    });

    it("no token at all -> a clear requires_token error", async () => {
      const res = await call("vault_get", { name: "A" });
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ success: false, requires_token: true });
    });

    it("non-vault tools are unaffected by the token context", async () => {
      mockGetDiscoveryCatalog.mockResolvedValue({ models: [] });
      const res = await call("list_models", { limit: 5 });
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
    });
  });
});
