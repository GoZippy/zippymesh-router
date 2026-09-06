/**
 * POST /api/mcp — the three-tier auth posture decided in the 2026-08-30
 * security pass (see the route's header comment and
 * docs/_internal/SECURITY_AUDIT_2026-08-30.md).
 *
 * The gap this closes: `src/middleware.js` admits a router API key on an HMAC
 * check alone. The edge has no database, so a REVOKED key still satisfies it
 * (middleware.js says so in its own comment and tells routes to re-check).
 * `/api/mcp` did not re-check, so a revoked key reached every non-vault tool.
 *
 * Tiers:
 *   1. read-only discovery  -> edge gate only, no route-level check
 *   2. mutating / executing -> live session OR DB-verified router key
 *   3. vault_*              -> scoped ZippyVault agent token, UNCHANGED
 *
 * The discovery/vault leaf modules are mocked so the real zmlr-server tool
 * definitions (and therefore the real MUTATING_TOOLS derivation) are exercised.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── leaf seams for the tool handlers ─────────────────────────────────────────

const MODEL = {
  id: "m-1", name: "Model One", provider: "test", capabilities: ["code"],
  isFree: true, local: false, contextWindow: 8192, isFast: true,
  inputPrice: 0, outputPrice: 0, requiresAuth: false, baseUrl: "http://localhost:1",
};

const svc = vi.hoisted(() => ({
  getDiscoveryCatalog: vi.fn(),
  detectCapabilities: vi.fn(() => ["code"]),
  getRecommendations: vi.fn(async () => ({
    recommendations: [{ modelId: "m-1", reasoning: ["cheap"] }],
    fallbackChain: ["m-1", "m-2", "m-3"],
  })),
  validateModel: vi.fn(async () => ({ valid: true })),
  getModelsByCapability: vi.fn(async () => ({ capability: "code", count: 1, models: [] })),
}));

vi.mock("../../src/lib/discovery/catalogService.js", () => ({
  getDiscoveryCatalog: (...a) => svc.getDiscoveryCatalog(...a),
  detectCapabilities: (...a) => svc.detectCapabilities(...a),
}));
vi.mock("../../src/lib/discovery/recommendationService.js", () => ({
  getRecommendations: (...a) => svc.getRecommendations(...a),
  validateModel: (...a) => svc.validateModel(...a),
  getModelsByCapability: (...a) => svc.getModelsByCapability(...a),
}));

const vaultMock = vi.hoisted(() => ({
  isVaultUnlocked: vi.fn(() => true),
  listVaultEntries: vi.fn(() => [{ name: "A" }]),
  readVaultEntryWithToken: vi.fn(() => ({ ok: false, code: "unauthorized", error: "bad token" })),
  listVaultEntriesWithToken: vi.fn(() => ({ ok: false, code: "unauthorized", error: "bad token" })),
  storeVaultEntryWithToken: vi.fn(() => ({ ok: false, code: "unauthorized", error: "bad token" })),
}));
vi.mock("../../src/lib/vault.js", () => ({
  isVaultUnlocked: (...a) => vaultMock.isVaultUnlocked(...a),
  listVaultEntries: (...a) => vaultMock.listVaultEntries(...a),
}));
vi.mock("../../src/lib/vaultTokens.js", () => ({
  readVaultEntryWithToken: (...a) => vaultMock.readVaultEntryWithToken(...a),
  listVaultEntriesWithToken: (...a) => vaultMock.listVaultEntriesWithToken(...a),
  storeVaultEntryWithToken: (...a) => vaultMock.storeVaultEntryWithToken(...a),
}));

// ── auth seams ───────────────────────────────────────────────────────────────

const auth = vi.hoisted(() => ({
  /** what checkAuth() returns */
  session: false,
  /** thrown by requireApiKey when set, else resolved scopes */
  keyError: null,
  keyScopes: [],
  checkAuth: vi.fn(),
  requireApiKey: vi.fn(),
}));

vi.mock("../../src/lib/auth/middleware.js", () => ({
  checkAuth: (...a) => { auth.checkAuth(...a); return Promise.resolve(auth.session); },
}));
vi.mock("../../src/lib/auth/apiKey.js", () => ({
  requireApiKey: (...a) => {
    auth.requireApiKey(...a);
    if (auth.keyError) return Promise.reject(auth.keyError);
    return Promise.resolve(auth.keyScopes);
  },
}));

const route = await import("../../src/app/api/mcp/route.js");
const { MUTATING_TOOLS } = await import("../../src/mcp/zmlr-server.js");

// ── helpers ──────────────────────────────────────────────────────────────────

function req(body, headers = {}) {
  const h = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    headers: { get: (k) => h[k.toLowerCase()] ?? null },
    json: async () => body,
  };
}

async function post(body, headers) {
  const res = await route.POST(req(body, headers));
  return { status: res.status, body: await res.json() };
}

const unauthorized = (code = 401, message = "Missing API key") =>
  Object.assign(new Error(message), { code });

const READ_ONLY_TOOLS = [
  "list_models",
  "recommend_model",
  "validate_model",
  "get_models_by_capability",
  "get_routing_metadata",
  "vault_status",
];

beforeEach(() => {
  vi.clearAllMocks();
  // A one-model catalog, so every read-only handler can succeed and a 502
  // ("handler reported success:false") can only mean a real failure.
  svc.getDiscoveryCatalog.mockResolvedValue({
    models: [MODEL], sources: { test: 1 }, totalModels: 1,
  });
  auth.session = false;
  auth.keyError = unauthorized();
  auth.keyScopes = [];
});

// ── the classification itself ────────────────────────────────────────────────

describe("tool classification", () => {
  it("execute_with_routing is the only mutating non-vault tool today", () => {
    expect([...MUTATING_TOOLS]).toEqual(["execute_with_routing"]);
  });

  it("no vault_* tool is in MUTATING_TOOLS — their agent-token gate is stronger", () => {
    for (const name of MUTATING_TOOLS) expect(name.startsWith("vault_")).toBe(false);
  });

  it("GET advertises the mutating set alongside the flat tool list", async () => {
    const res = await route.GET();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).toEqual(expect.arrayContaining([...READ_ONLY_TOOLS, "execute_with_routing"]));
    expect(body.mutatingTools).toEqual(["execute_with_routing"]);
  });
});

// ── tier 1: read-only discovery ──────────────────────────────────────────────

describe("tier 1 — read-only discovery tools are not re-gated at the route", () => {
  it.each(READ_ONLY_TOOLS)("%s runs with no session and no API key", async (tool) => {
    const { status } = await post({ tool, input: { intent: "code", model_id: "m-1", capability: "code" } });
    expect(status).toBe(200);
    expect(auth.checkAuth).not.toHaveBeenCalled();
    expect(auth.requireApiKey).not.toHaveBeenCalled();
  });
});

// ── tier 2: mutating / executing ─────────────────────────────────────────────

describe("tier 2 — execute_with_routing demands a live caller identity", () => {
  const call = (headers) => post({ tool: "execute_with_routing", input: { intent: "code", task: "t" } }, headers);

  it("401s with no session and no key", async () => {
    const { status, body } = await call();
    expect(status).toBe(401);
    expect(body).toMatchObject({ success: false, error: "unauthorized", tool: "execute_with_routing" });
  });

  it("401s for a REVOKED key — the gap the edge HMAC check cannot close", async () => {
    // requireApiKey consults the DB, where the key is marked revoked, so it
    // throws even though the same key satisfies middleware.js's HMAC check.
    auth.keyError = unauthorized(401, "Invalid API key");
    const { status, body } = await call({ authorization: "Bearer sk-revoked-but-well-formed" });
    expect(status).toBe(401);
    expect(body.detail).toContain("Invalid API key");
  });

  it("does not reach the handler when refused", async () => {
    await call();
    expect(svc.getRecommendations).not.toHaveBeenCalled();
  });

  it("allows a valid dashboard session without asking for a key", async () => {
    auth.session = true;
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(auth.requireApiKey).not.toHaveBeenCalled();
  });

  it("allows a live, unscoped router API key", async () => {
    auth.keyError = null;
    auth.keyScopes = [];
    const { status, body } = await call({ authorization: "Bearer sk-live" });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(auth.requireApiKey).toHaveBeenCalledTimes(1);
  });

  it("allows a scoped key carrying '*' or 'mcp'", async () => {
    auth.keyError = null;
    for (const scopes of [["*"], ["mcp"], ["chat", "mcp"]]) {
      auth.keyScopes = scopes;
      expect((await call({ authorization: "Bearer sk-live" })).status, JSON.stringify(scopes)).toBe(200);
    }
  });

  it("403s a scoped key that lacks an mcp scope", async () => {
    auth.keyError = null;
    auth.keyScopes = ["chat"];
    const { status, body } = await call({ authorization: "Bearer sk-live" });
    expect(status).toBe(403);
    expect(body).toMatchObject({ success: false, error: "forbidden" });
  });

  it("propagates 403 (blacklisted) and 429 (rate limited) from requireApiKey", async () => {
    auth.keyError = unauthorized(403, "API key blacklisted");
    expect((await call({ authorization: "Bearer sk-x" })).status).toBe(403);
    auth.keyError = unauthorized(429, "Rate limit exceeded");
    expect((await call({ authorization: "Bearer sk-x" })).status).toBe(429);
  });

  it("never echoes the presented credential back to the caller", async () => {
    const secret = "sk-super-secret-value";
    const { body } = await call({ authorization: `Bearer ${secret}` });
    expect(JSON.stringify(body)).not.toContain(secret);
  });
});

// ── tier 3: vault tools unchanged ────────────────────────────────────────────

describe("tier 3 — vault_* behaviour is untouched by the tiering", () => {
  it("vault_get/list/store still reach their handler and enforce the agent token", async () => {
    for (const tool of ["vault_get", "vault_list", "vault_store"]) {
      const { status, body } = await post({ tool, input: { name: "A", value: "v" } });
      // Handler ran and reported its own token failure (502 = handler success:false),
      // NOT a route-level 401 — the vault gate is the handler's, not the route's.
      expect(status, tool).toBe(502);
      expect(body.success).toBe(false);
      expect(auth.requireApiKey).not.toHaveBeenCalled();
    }
  });

  it("the agent token still comes from the header, and a router key is not one", async () => {
    vaultMock.listVaultEntriesWithToken.mockReturnValueOnce({
      ok: true, unlocked: true, scopes: ["*"], entries: [],
    });
    await post({ tool: "vault_list", input: {} }, { "x-zippyvault-token": "agent-token-1" });
    expect(vaultMock.listVaultEntriesWithToken).toHaveBeenCalledWith("agent-token-1");

    // An `sk-` bearer is a router key, never a vault token: the handler must be
    // told there is no token rather than being handed the router key.
    const { body } = await post({ tool: "vault_list", input: {} }, { authorization: "Bearer sk-router-key" });
    expect(body).toMatchObject({ success: false, requires_token: true });
  });
});

// ── request shape ────────────────────────────────────────────────────────────

describe("malformed requests are rejected before any auth work", () => {
  it("400 on invalid JSON", async () => {
    const res = await route.POST({
      headers: { get: () => null },
      json: async () => { throw new SyntaxError("bad"); },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
  });

  it("400 when 'tool' is missing or not a string", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ tool: 42 })).status).toBe(400);
  });

  it("404 for an unknown tool, without consulting auth", async () => {
    const { status, body } = await post({ tool: "definitely_not_a_tool" });
    expect(status).toBe(404);
    expect(body.error).toBe("unknown_tool");
    expect(auth.checkAuth).not.toHaveBeenCalled();
  });
});
