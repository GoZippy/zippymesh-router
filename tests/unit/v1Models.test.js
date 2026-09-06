/**
 * `GET /v1/models` — what an install can actually serve, how fast, and who may ask.
 *
 * Measured on dev-beta 2026-08-30 (docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md §3):
 * 7.4–27.6 s per call, 475 models on an install with ZERO providers connected,
 * an unconditional outbound fetch to api.kilo.ai on every single call, and no
 * `requireApiKey` gate at all. Every one of those is asserted against here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockGetProviderConnections, mockGetCombos, mockGetDb, mockGetRoutingPlaybooks,
  mockGetProviderNodes, mockGetSettings, mockGetSidecarPeers, mockGetRegistryModels,
  mockMaybeAutoRefresh, mockGetLocalModelIndex, mockRequireApiKey,
} = vi.hoisted(() => ({
  mockGetProviderConnections: vi.fn(async () => []),
  mockGetCombos: vi.fn(async () => []),
  mockGetDb: vi.fn(async () => ({ data: {} })),
  mockGetRoutingPlaybooks: vi.fn(async () => []),
  mockGetProviderNodes: vi.fn(async () => []),
  mockGetSettings: vi.fn(async () => ({})),
  mockGetSidecarPeers: vi.fn(async () => []),
  mockGetRegistryModels: vi.fn(async () => []),
  mockMaybeAutoRefresh: vi.fn(async () => ({ skipped: true })),
  mockGetLocalModelIndex: vi.fn(async () => ({ fetchedAt: Date.now(), entries: [], byId: new Map(), byTag: new Map() })),
  mockRequireApiKey: vi.fn(async () => []),
}));

vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnections: mockGetProviderConnections,
  getCombos: mockGetCombos,
  getDb: mockGetDb,
  getRoutingPlaybooks: mockGetRoutingPlaybooks,
  getProviderNodes: mockGetProviderNodes,
  getSettings: mockGetSettings,
}));
vi.mock("../../src/lib/sidecar.js", () => ({ getSidecarPeers: mockGetSidecarPeers }));
vi.mock("../../src/lib/modelRegistry.js", () => ({ getRegistryModels: mockGetRegistryModels }));
vi.mock("../../src/lib/providers/sync.js", () => ({ maybeAutoRefreshProviderCatalog: mockMaybeAutoRefresh }));
vi.mock("../../src/lib/routing/localModelIndex.js", () => ({ getLocalModelIndex: mockGetLocalModelIndex }));
vi.mock("../../src/lib/auth/apiKey.js", () => ({ requireApiKey: mockRequireApiKey }));
// The route builds its 401/403 with apiError() so the envelope (type, code,
// request_id, CORS header) matches every other error on /v1 — stub the request-id
// source so the test does not touch the usage DB.
vi.mock("../../src/lib/usageDb.js", () => ({ generateRequestId: () => "req-test" }));

import { GET, __clearModelsRouteCaches } from "../../src/app/api/v1/models/route.js";

const OLLAMA_NODE = { id: "n1", name: "Ollama (127.0.0.1)", baseUrl: "http://127.0.0.1:11434", apiType: "ollama", type: "local" };

function localIndex(tags) {
  const entries = tags.map((tag) => ({ id: `ollama/${tag}`, tag, prefix: "ollama", node: OLLAMA_NODE }));
  return {
    fetchedAt: Date.now(),
    entries,
    byId: new Map(entries.map((e) => [e.id, e])),
    byTag: new Map(entries.map((e) => [e.tag, [e]])),
  };
}

function get(query = "", headers = {}) {
  return GET(new Request(`http://127.0.0.1:20128/v1/models${query}`, { headers }));
}

const REAL_FETCH = globalThis.fetch;
const ORIGINAL_OFFLINE = process.env.ZIPPY_OFFLINE;

beforeEach(() => {
  vi.clearAllMocks();
  __clearModelsRouteCaches();
  mockGetProviderConnections.mockResolvedValue([]);
  mockGetSettings.mockResolvedValue({});
  mockGetLocalModelIndex.mockResolvedValue(localIndex(["qwen3.5:4b", "nomic-embed-text:latest"]));
  // The unit-test harness forces ZIPPY_OFFLINE=true (tests/unit/_setup/dataDir.mjs);
  // clear it so the network-gating tests control it explicitly.
  delete process.env.ZIPPY_OFFLINE;
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  if (ORIGINAL_OFFLINE === undefined) delete process.env.ZIPPY_OFFLINE;
  else process.env.ZIPPY_OFFLINE = ORIGINAL_OFFLINE;
});

async function ids(res) {
  const json = await res.json();
  return (json.data || []).map((m) => m.id);
}

describe("what the list contains", () => {
  it("is an OpenAI list", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.object).toBe("list");
    expect(Array.isArray(json.data)).toBe(true);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("advertises a local Ollama model as `ollama/<tag>`, with the bare tag in `root`", async () => {
    const json = await (await get()).json();
    const entry = json.data.find((m) => m.id === "ollama/qwen3.5:4b");
    expect(entry).toBeTruthy();
    expect(entry.object).toBe("model");
    expect(entry.owned_by).toBe("ollama");
    expect(entry.root).toBe("qwen3.5:4b");
    expect(entry.zippy).toMatchObject({ source: "local", baseUrl: "http://127.0.0.1:11434" });
    // The bare tag is never advertised — the prefix is part of the id.
    expect(json.data.some((m) => m.id === "qwen3.5:4b")).toBe(false);
  });

  it("still advertises the routing playbooks", async () => {
    const list = await ids(await get());
    for (const id of ["auto", "zippymesh/code-focus", "local/privacy-strict"]) {
      expect(list).toContain(id);
    }
  });

  it("lists NOTHING from the static cloud catalogue when no provider is connected", async () => {
    const list = await ids(await get());
    const cloud = list.filter((id) => !id.startsWith("ollama/") && !id.startsWith("lmstudio/") && !id.startsWith("p2p/") && !["auto"].includes(id) && !/^(zippymesh|free|local|urgent|mixed)\//.test(id));
    expect(cloud).toEqual([]);
  });

  it("lists a provider's models once it has an active connection", async () => {
    mockGetProviderConnections.mockResolvedValue([{ provider: "openai", isActive: true }]);
    const list = await ids(await get());
    expect(list.some((id) => id.startsWith("openai/"))).toBe(true);
    expect(list.some((id) => id.startsWith("anthropic/"))).toBe(false);
  });

  it("?all=1 opts back in to the full static catalogue", async () => {
    const filtered = await ids(await get());
    const all = await ids(await get("?all=1"));
    expect(all.length).toBeGreaterThan(filtered.length);
    expect(all.some((id) => id.startsWith("openai/"))).toBe(true);
    // ?catalog=1 is the same switch.
    expect((await ids(await get("?catalog=1"))).length).toBe(all.length);
  });
});

describe("it no longer phones home on every call", () => {
  it("does not fetch api.kilo.ai when Kilo is not connected", async () => {
    await get();
    const urls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("api.kilo.ai"))).toBe(false);
  });

  it("does fetch a cloud catalogue for a provider that IS connected", async () => {
    mockGetProviderConnections.mockResolvedValue([{ provider: "kilo", isActive: true, apiKey: "k" }]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "some/cloud-model" }] }) }));
    const list = await ids(await get());
    expect(globalThis.fetch.mock.calls.map((c) => String(c[0])).some((u) => u.includes("api.kilo.ai"))).toBe(true);
    expect(list).toContain("some/cloud-model");
  });

  it("caches the cloud catalogue instead of re-fetching per request", async () => {
    mockGetProviderConnections.mockResolvedValue([{ provider: "kilo", isActive: true, apiKey: "k" }]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "some/cloud-model" }] }) }));
    await get();
    await get();
    await get();
    const kiloCalls = globalThis.fetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("api.kilo.ai"));
    expect(kiloCalls.length).toBe(1);
  });

  it("ZIPPY_OFFLINE=true blocks the cloud fetch and the catalogue sync entirely", async () => {
    process.env.ZIPPY_OFFLINE = "true";
    mockGetProviderConnections.mockResolvedValue([{ provider: "kilo", isActive: true, apiKey: "k" }]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "some/cloud-model" }] }) }));
    const res = await get("?all=1");
    expect(res.status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockMaybeAutoRefresh).not.toHaveBeenCalled();
  });

  it("settings.offlineMode:true does the same without an env var", async () => {
    mockGetSettings.mockResolvedValue({ offlineMode: true });
    mockGetProviderConnections.mockResolvedValue([{ provider: "kilo", isActive: true, apiKey: "k" }]);
    await get();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockMaybeAutoRefresh).not.toHaveBeenCalled();
  });

  it("never awaits the provider-catalogue sync on the request path", async () => {
    // maybeAutoRefreshProviderCatalog() sleeps a random 0-30s jitter before it
    // even starts; awaiting it was most of the measured 7-28s.
    let settle;
    mockMaybeAutoRefresh.mockImplementation(() => new Promise((r) => { settle = r; }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(mockMaybeAutoRefresh).toHaveBeenCalled();
    settle?.({});
  });
});

describe("requireApiKey gate", () => {
  it("is open when the setting is off", async () => {
    mockGetSettings.mockResolvedValue({ requireApiKey: false });
    expect((await get()).status).toBe(200);
    expect(mockRequireApiKey).not.toHaveBeenCalled();
  });

  it("401s in the OpenAI envelope when the setting is on and no key is sent", async () => {
    mockGetSettings.mockResolvedValue({ requireApiKey: true });
    mockRequireApiKey.mockImplementation(async () => {
      const err = new Error("Missing API key");
      err.code = 401;
      throw err;
    });
    const res = await get();
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.message).toBe("Missing API key");
    expect(json.error.type).toBe("authentication_error");
    expect(json.error.code).toBe("invalid_api_key");
    // Same envelope as every other /v1 error, request_id included.
    expect(typeof json.error.request_id).toBe("string");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("200s with a valid bearer when the setting is on", async () => {
    mockGetSettings.mockResolvedValue({ requireApiKey: true });
    mockRequireApiKey.mockResolvedValue([]);
    const res = await get("", { Authorization: "Bearer good" });
    expect(res.status).toBe(200);
    expect(mockRequireApiKey).toHaveBeenCalled();
  });

  it("relays a 403 (blacklisted) with ZMLR's standard permission envelope", async () => {
    mockGetSettings.mockResolvedValue({ requireApiKey: true });
    mockRequireApiKey.mockImplementation(async () => {
      const err = new Error("IP blacklisted");
      err.code = 403;
      throw err;
    });
    const res = await get();
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.message).toBe("IP blacklisted");
    expect(json.error.type).toBe("permission_error");
  });
});
