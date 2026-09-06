/**
 * `POST /api/provider-nodes {type:"local"}` — the one-call way to tell ZMLR
 * about a runtime the user already has running.
 *
 * Before 2026-08-30 this returned `400 Invalid provider node type` and the only
 * working path was `POST /api/discovery`: a sweep of every /24 of every
 * non-internal IPv4 interface that took 240 s on a four-interface box and
 * registered the same Ollama TWICE (`http://127.0.0.1:11434` and
 * `http://localhost:11434`) because the dedupe set was snapshotted before the
 * probe loop. See docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md §10.
 *
 * Both the fast path and the sweep now go through `registerLocalRuntime`, so
 * they cannot drift apart, and both dedupe by normalized host:port.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreateProviderNode, mockGetProviderNodes, nodeStore } = vi.hoisted(() => {
  const nodeStore = { nodes: [] };
  return {
    nodeStore,
    mockGetProviderNodes: vi.fn(async () => nodeStore.nodes.slice()),
    mockCreateProviderNode: vi.fn(async (data) => {
      const node = { id: `node-${nodeStore.nodes.length + 1}`, ...data };
      nodeStore.nodes.push(node);
      return node;
    }),
  };
});

vi.mock("../../src/lib/localDb.js", () => ({
  createProviderNode: mockCreateProviderNode,
  getProviderNodes: mockGetProviderNodes,
  getNodeIdentity: vi.fn(async () => ({ publicKey: "PUB" })),
  // POST/GET /api/provider-nodes are wrapped in requireAuth as of 2026-08-30
  // (finding C1a). `requireLogin:false` is the documented open mode, in which
  // checkAuth() returns true — so these tests exercise the same handler bodies
  // they always did. The GUARD itself is covered by providerNodesGuard.test.js.
  getSettings: vi.fn(async () => ({ requireLogin: false })),
}));

vi.mock("../../src/models/index.js", () => ({
  createProviderNode: mockCreateProviderNode,
  getProviderNodes: mockGetProviderNodes,
}));

vi.mock("../../src/lib/security.js", () => ({
  signPayload: vi.fn(async () => "jwt"),
  verifyPayload: vi.fn(async () => ({})),
}));

import {
  normalizeNodeKey,
  normalizeLocalBaseUrl,
  resolveLocalApiType,
  probeLocalRuntime,
  registerLocalRuntime,
  LocalDiscoveryService,
} from "../../src/lib/discovery/localDiscovery.js";
import { POST } from "../../src/app/api/provider-nodes/route.js";
import {
  getLocalModelIndex,
  invalidateLocalModelIndex,
  resolveBareModelId,
  pickLocalDefaultModel,
} from "../../src/lib/routing/localModelIndex.js";

const OLLAMA_TAGS = { models: [{ name: "qwen3.5:4b" }, { name: "nomic-embed-text:latest" }] };
const LMSTUDIO_MODELS = { data: [{ id: "llama-3.2-3b" }] };

/** Fake fetch that answers only for the hosts/ports we say are up. */
function fakeFetch(up = { "127.0.0.1:11434": "ollama" }) {
  return vi.fn(async (url) => {
    const u = new URL(String(url));
    const host = u.hostname === "localhost" || u.hostname === "[::1]" || u.hostname === "::1" ? "127.0.0.1" : u.hostname;
    const port = u.port || "80";
    const kind = up[`${host}:${port}`];
    if (!kind) return { ok: false, status: 502, json: async () => ({}) };
    if (kind === "ollama" && u.pathname === "/api/tags") {
      return { ok: true, status: 200, json: async () => OLLAMA_TAGS };
    }
    if (kind === "openai" && u.pathname === "/v1/models") {
      return { ok: true, status: 200, json: async () => LMSTUDIO_MODELS };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

function req(body) {
  return new Request("http://127.0.0.1:20128/api/provider-nodes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const REAL_FETCH = globalThis.fetch;

beforeEach(() => {
  nodeStore.nodes = [];
  mockCreateProviderNode.mockClear();
  mockGetProviderNodes.mockClear();
  invalidateLocalModelIndex();
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

describe("normalizeNodeKey — the dedupe identity", () => {
  it("collapses every loopback spelling to one key", () => {
    const keys = [
      "http://127.0.0.1:11434",
      "http://localhost:11434",
      "http://localhost:11434/",
      "http://[::1]:11434",
      "http://127.0.0.1:11434/v1",
    ].map(normalizeNodeKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("localhost:11434");
  });

  it("keeps distinct hosts and ports distinct", () => {
    expect(normalizeNodeKey("http://127.0.0.1:11434")).not.toBe(normalizeNodeKey("http://127.0.0.1:1234"));
    expect(normalizeNodeKey("http://10.0.11.2:11434")).toBe("10.0.11.2:11434");
    expect(normalizeNodeKey("https://example.com/v1")).toBe("example.com:443");
  });

  it("returns null for garbage rather than throwing", () => {
    expect(normalizeNodeKey("not a url")).toBeNull();
    expect(normalizeNodeKey(null)).toBeNull();
    expect(normalizeNodeKey("")).toBeNull();
  });
});

describe("normalizeLocalBaseUrl / resolveLocalApiType", () => {
  it("stores an Ollama base URL bare and an OpenAI-shaped one with /v1", () => {
    expect(normalizeLocalBaseUrl("http://127.0.0.1:11434/", "ollama"))
      .toEqual({ root: "http://127.0.0.1:11434", baseUrl: "http://127.0.0.1:11434" });
    expect(normalizeLocalBaseUrl("http://127.0.0.1:1234", "lmstudio"))
      .toEqual({ root: "http://127.0.0.1:1234", baseUrl: "http://127.0.0.1:1234/v1" });
  });

  it("accepts a URL the user already suffixed with /v1 and does not double it", () => {
    expect(normalizeLocalBaseUrl("http://127.0.0.1:1234/v1", "lmstudio").baseUrl)
      .toBe("http://127.0.0.1:1234/v1");
  });

  it("assumes http:// when the scheme is missing", () => {
    expect(normalizeLocalBaseUrl("127.0.0.1:11434", "ollama").root).toBe("http://127.0.0.1:11434");
  });

  it("maps every accepted apiType spelling", () => {
    expect(resolveLocalApiType("ollama")).toBe("ollama");
    expect(resolveLocalApiType("LM-Studio")).toBe("lmstudio");
    expect(resolveLocalApiType("llama.cpp")).toBe("llamacpp");
    expect(resolveLocalApiType("openai-compatible")).toBe("openai-compatible");
    expect(resolveLocalApiType("openai")).toBe("openai-compatible");
    expect(resolveLocalApiType("anthropic")).toBeNull();
    expect(resolveLocalApiType(undefined)).toBeNull();
  });
});

describe("probeLocalRuntime", () => {
  it("reads the Ollama tag list from /api/tags", async () => {
    globalThis.fetch = fakeFetch();
    const probed = await probeLocalRuntime("http://127.0.0.1:11434", "ollama", 5000);
    expect(probed.ok).toBe(true);
    expect(probed.models).toEqual(["qwen3.5:4b", "nomic-embed-text:latest"]);
  });

  it("reads an OpenAI-compatible list from /v1/models", async () => {
    globalThis.fetch = fakeFetch({ "127.0.0.1:1234": "openai" });
    const probed = await probeLocalRuntime("http://127.0.0.1:1234", "lmstudio", 5000);
    expect(probed.ok).toBe(true);
    expect(probed.models).toEqual(["llama-3.2-3b"]);
  });

  it("reports not-ok instead of throwing when nothing answers", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const probed = await probeLocalRuntime("http://127.0.0.1:9", "ollama", 500);
    expect(probed.ok).toBe(false);
    // A FAILURE CLASS, not the transport text. Echoing `ECONNREFUSED` vs
    // `timed out` vs `HTTP 401` back to the caller made this route a port
    // scanner and firewall mapper (finding H1) — see providerNodesGuard.test.js.
    expect(probed.error).toBe("unreachable");
  });
});

describe("POST /api/provider-nodes {type:'local'}", () => {
  it("registers Ollama in one call and reports the ids a client can send", async () => {
    globalThis.fetch = fakeFetch();
    const res = await POST(req({ type: "local", apiType: "ollama", baseUrl: "http://127.0.0.1:11434" }));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.created).toBe(true);
    expect(json.node.type).toBe("local");
    expect(json.node.apiType).toBe("ollama");
    expect(json.node.baseUrl).toBe("http://127.0.0.1:11434");
    expect(json.models).toEqual(["qwen3.5:4b", "nomic-embed-text:latest"]);
    // The id form the contract promises: <provider>/<provider-local-id>.
    expect(json.modelIds).toContain("ollama/qwen3.5:4b");
  });

  it("defaults the baseUrl per apiType so {type,apiType} alone is enough", async () => {
    globalThis.fetch = fakeFetch();
    const res = await POST(req({ type: "local", apiType: "ollama" }));
    expect(res.status).toBe(201);
    expect((await res.json()).node.baseUrl).toBe("http://127.0.0.1:11434");
  });

  it("needs neither name nor prefix (both are optional for a local runtime)", async () => {
    globalThis.fetch = fakeFetch();
    const res = await POST(req({ type: "local", apiType: "ollama" }));
    expect(res.status).toBe(201);
    const { node } = await res.json();
    expect(node.name).toBe("Ollama (127.0.0.1)");
    expect(node.prefix).toBe("local-ollama-");
  });

  it("dedupes 127.0.0.1 against an already-registered localhost node", async () => {
    globalThis.fetch = fakeFetch();
    const first = await POST(req({ type: "local", apiType: "ollama", baseUrl: "http://localhost:11434" }));
    expect(first.status).toBe(201);

    const second = await POST(req({ type: "local", apiType: "ollama", baseUrl: "http://127.0.0.1:11434" }));
    expect(second.status).toBe(200);
    const json = await second.json();
    expect(json.created).toBe(false);
    expect(json.deduped).toBe(true);
    expect(json.node.baseUrl).toBe("http://localhost:11434");
    expect(mockCreateProviderNode).toHaveBeenCalledTimes(1);
    expect(nodeStore.nodes.length).toBe(1);
  });

  it("502s when nothing answers at the URL, and registers nothing", async () => {
    globalThis.fetch = fakeFetch({});
    const res = await POST(req({ type: "local", apiType: "ollama", baseUrl: "http://127.0.0.1:11434" }));
    expect(res.status).toBe(502);
    expect(mockCreateProviderNode).not.toHaveBeenCalled();
  });

  it("400s on an apiType that is not a local runtime, naming the accepted values", async () => {
    globalThis.fetch = fakeFetch();
    const res = await POST(req({ type: "local", apiType: "anthropic", baseUrl: "http://127.0.0.1:11434" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    const message = body?.error?.message ?? body?.error ?? "";
    expect(String(message)).toMatch(/ollama/);
  });

  it("leaves the existing openai-compatible path untouched", async () => {
    globalThis.fetch = fakeFetch();
    const res = await POST(req({
      type: "openai-compatible", name: "Some API", prefix: "sx", apiType: "chat", baseUrl: "https://example.com/v1",
    }));
    expect(res.status).toBe(201);
    const { node } = await res.json();
    expect(node.type).toBe("openai-compatible");
    expect(node.prefix).toBe("sx");
  });

  it("still requires name + prefix for an openai-compatible node", async () => {
    const res = await POST(req({ type: "openai-compatible", apiType: "chat", baseUrl: "https://example.com/v1" }));
    expect(res.status).toBe(400);
  });
});

describe("LocalDiscoveryService.scan() dedupe", () => {
  it("registers a loopback runtime ONCE even though it answers on both spellings", async () => {
    globalThis.fetch = fakeFetch();
    const svc = new LocalDiscoveryService();
    // Only probe the two loopback spellings: no subnet sweep in a unit test.
    svc.scanTargets = ["127.0.0.1", "localhost"];
    const originalInterfaces = (await import("node:os")).default.networkInterfaces;
    const os = (await import("node:os")).default;
    os.networkInterfaces = () => ({});
    try {
      const provisioned = await svc.scan();
      expect(provisioned.length).toBe(1);
      // 127.0.0.1 is the first scan target, so it is the spelling that survives.
      expect(provisioned[0].baseUrl).toBe("http://127.0.0.1:11434");
      expect(nodeStore.nodes.length).toBe(1);
    } finally {
      os.networkInterfaces = originalInterfaces;
    }
  });

  it("does not re-register a runtime that is already in the DB under another spelling", async () => {
    nodeStore.nodes.push({ id: "existing", type: "local", apiType: "ollama", baseUrl: "http://localhost:11434" });
    globalThis.fetch = fakeFetch();
    const svc = new LocalDiscoveryService();
    svc.scanTargets = ["127.0.0.1", "localhost"];
    const os = (await import("node:os")).default;
    const originalInterfaces = os.networkInterfaces;
    os.networkInterfaces = () => ({});
    try {
      const provisioned = await svc.scan();
      expect(provisioned.length).toBe(0);
      expect(mockCreateProviderNode).not.toHaveBeenCalled();
    } finally {
      os.networkInterfaces = originalInterfaces;
    }
  });
});

/**
 * The index of what the registered local runtimes serve. It is what makes
 * `model:"auto"` resolvable on a box with no static model table
 * (`PROVIDER_MODELS` has no "ollama" entry, on purpose) and what lets a bare
 * provider-local tag round-trip.
 */
describe("localModelIndex", () => {
  const OLLAMA_NODE = { id: "n1", type: "local", apiType: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434" };

  it("indexes a registered runtime as `<prefix>/<tag>` with the bare tag as a key", async () => {
    nodeStore.nodes.push(OLLAMA_NODE);
    globalThis.fetch = fakeFetch();
    const index = await getLocalModelIndex();
    expect(index.entries.map((e) => e.id)).toEqual(["ollama/qwen3.5:4b", "ollama/nomic-embed-text:latest"]);
    expect(index.byTag.get("qwen3.5:4b")[0].id).toBe("ollama/qwen3.5:4b");
  });

  it("serves repeat reads from the TTL cache instead of re-probing", async () => {
    nodeStore.nodes.push(OLLAMA_NODE);
    globalThis.fetch = fakeFetch();
    await getLocalModelIndex();
    await getLocalModelIndex();
    await getLocalModelIndex();
    expect(globalThis.fetch.mock.calls.length).toBe(1);
  });

  it("resolves a bare tag to the provider-qualified id", async () => {
    nodeStore.nodes.push(OLLAMA_NODE);
    globalThis.fetch = fakeFetch();
    expect(await resolveBareModelId("qwen3.5:4b")).toBe("ollama/qwen3.5:4b");
  });

  it("refuses to resolve an unknown tag, an already-qualified id, or `auto`", async () => {
    nodeStore.nodes.push(OLLAMA_NODE);
    globalThis.fetch = fakeFetch();
    expect(await resolveBareModelId("does-not-exist:0b")).toBeNull();
    expect(await resolveBareModelId("ollama/qwen3.5:4b")).toBeNull();
    expect(await resolveBareModelId("auto")).toBeNull();
    expect(await resolveBareModelId("")).toBeNull();
    expect(await resolveBareModelId(undefined)).toBeNull();
  });

  it("resolves an ambiguous tag to the LOOPBACK provider rather than refusing (C1d)", async () => {
    // Was: `matches.length !== 1` -> null, so registering ANY node that served
    // an existing tag made that tag stop resolving (the bare-tag DoS in the
    // 2026-08-30 adversarial review). Both of these are loopback, so the first
    // in index order — loopback, then earliest registration — wins.
    nodeStore.nodes.push(OLLAMA_NODE);
    nodeStore.nodes.push({ id: "n2", type: "local", apiType: "openai", name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" });
    globalThis.fetch = vi.fn(async (url) => {
      const u = new URL(String(url));
      if (u.pathname === "/api/tags") return { ok: true, status: 200, json: async () => ({ models: [{ name: "shared-model" }] }) };
      if (u.pathname === "/v1/models") return { ok: true, status: 200, json: async () => ({ data: [{ id: "shared-model" }] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    expect(await resolveBareModelId("shared-model")).toBe("ollama/shared-model");
  });

  it("still refuses when only REMOTE nodes serve the tag and there is nothing to prefer", async () => {
    nodeStore.nodes.push({ id: "r1", type: "local", apiType: "ollama", name: "A", baseUrl: "http://10.0.11.2:11434" });
    nodeStore.nodes.push({ id: "r2", type: "local", apiType: "openai", name: "B", baseUrl: "http://10.0.11.3:1234/v1" });
    globalThis.fetch = vi.fn(async (url) => {
      const u = new URL(String(url));
      if (u.pathname === "/api/tags") return { ok: true, status: 200, json: async () => ({ models: [{ name: "shared-model" }] }) };
      if (u.pathname === "/v1/models") return { ok: true, status: 200, json: async () => ({ data: [{ id: "shared-model" }] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    expect(await resolveBareModelId("shared-model")).toBeNull();
  });

  it("picks a chat model — never an embedding-only one — as the local default for `auto`", async () => {
    nodeStore.nodes.push(OLLAMA_NODE);
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      // embedding model listed FIRST, exactly the trap
      json: async () => ({ models: [{ name: "nomic-embed-text:latest" }, { name: "qwen3.5:4b" }] }),
    }));
    expect(await pickLocalDefaultModel("ollama")).toBe("qwen3.5:4b");
  });

  it("returns null for a provider with no local runtime, and for a cloud provider", async () => {
    globalThis.fetch = fakeFetch();
    expect(await pickLocalDefaultModel("ollama")).toBeNull();
    expect(await pickLocalDefaultModel("openai")).toBeNull();
  });

  it("prefers a model served by the node the candidate connection points at", async () => {
    nodeStore.nodes.push(OLLAMA_NODE);
    nodeStore.nodes.push({ id: "n2", type: "local", apiType: "ollama", name: "Remote", baseUrl: "http://10.0.11.2:11434" });
    globalThis.fetch = vi.fn(async (url) => {
      const u = new URL(String(url));
      const isRemote = u.hostname === "10.0.11.2";
      return { ok: true, status: 200, json: async () => ({ models: [{ name: isRemote ? "remote-model" : "local-model" }] }) };
    });
    expect(await pickLocalDefaultModel("ollama", { nodeId: "n2" })).toBe("remote-model");
    expect(await pickLocalDefaultModel("ollama", { baseUrl: "http://127.0.0.1:11434" })).toBe("local-model");
  });

  it("registering a node through the API invalidates the cached index", async () => {
    globalThis.fetch = fakeFetch();
    expect((await getLocalModelIndex()).entries).toEqual([]);   // nothing registered yet

    const res = await POST(req({ type: "local", apiType: "ollama", baseUrl: "http://127.0.0.1:11434" }));
    expect(res.status).toBe(201);

    // Without the invalidation this would still be the empty snapshot.
    expect((await getLocalModelIndex()).entries.map((e) => e.id)).toContain("ollama/qwen3.5:4b");
  });

  it("a runtime that has gone away yields an empty list, not a throw", async () => {
    nodeStore.nodes.push(OLLAMA_NODE);
    globalThis.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const index = await getLocalModelIndex();
    expect(index.entries).toEqual([]);
    expect(await resolveBareModelId("qwen3.5:4b")).toBeNull();
  });
});
