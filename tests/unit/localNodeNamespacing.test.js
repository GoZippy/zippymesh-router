/**
 * Per-node model namespacing (adversarial review 2026-08-30, finding C1c/C1d).
 *
 * `prefixForNode()` returned the flat string `"ollama"` for EVERY node with
 * `apiType === "ollama"`, so all Ollama nodes shared one `ollama/` namespace,
 * and `localModelIndex.js:110-125` resolved the collision with:
 *
 *     // First node wins for a given id; nodes are deduped by host:port at
 *     // registration so a collision here means two distinct runtimes serve
 *     // the same tag, and either is a correct answer.
 *
 * "Either is a correct answer" is only true when both runtimes are trusted, and
 * registration was not a trust decision. Verified end-to-end: an attacker server
 * claiming `qwen3.5:4b` was registered as a local node and then received the
 * operator's prompt for `ollama/qwen3.5:4b`.
 *
 * The scheme now (documented in the contract doc §3 / §10):
 *   - ONE node owns the bare `ollama/` namespace — the first LOOPBACK node, else
 *     the earliest-registered one — so every id that worked before still works;
 *   - every other node is `ollama@<host-port>/<tag>`, stable across restarts;
 *   - a bare tag served by several nodes resolves to the LOOPBACK one, and is
 *     only null when nothing but remote nodes serve it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetProviderNodes, nodeStore } = vi.hoisted(() => {
  const nodeStore = { nodes: [] };
  return { nodeStore, mockGetProviderNodes: vi.fn(async () => nodeStore.nodes.slice()) };
});

vi.mock("../../src/lib/localDb.js", () => ({
  getProviderNodes: mockGetProviderNodes,
  createProviderNode: vi.fn(async (d) => ({ id: "n", ...d })),
  getNodeIdentity: vi.fn(async () => ({ publicKey: "PUB" })),
  getSettings: vi.fn(async () => ({ requireLogin: false })),
}));

import {
  baseNamespaceFor,
  nodeSlug,
  ownerNodeIdFor,
  prefixForNode,
  getLocalModelIndex,
  invalidateLocalModelIndex,
  resolveBareModelId,
  resolveLocalRouteTarget,
  pickLocalDefaultModel,
} from "../../src/lib/routing/localModelIndex.js";

const REAL_FETCH = globalThis.fetch;

const REAL = { id: "real", type: "local", apiType: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434", createdAt: "2026-01-01T00:00:00.000Z" };
const EVIL = { id: "evil", type: "local", apiType: "ollama", name: "Ollama (127.0.0.1)", baseUrl: "http://127.0.0.1:20369", createdAt: "2026-06-01T00:00:00.000Z" };
const REMOTE = { id: "remote", type: "local", apiType: "ollama", name: "Remote", baseUrl: "http://10.0.11.2:11434", createdAt: "2026-02-01T00:00:00.000Z" };

/** Per-host tag lists. */
function tagFetch(byHostPort) {
  return vi.fn(async (url) => {
    const u = new URL(String(url));
    const tags = byHostPort[`${u.hostname}:${u.port}`] || [];
    if (u.pathname === "/api/tags") return { ok: true, status: 200, json: async () => ({ models: tags.map((t) => ({ name: t })) }) };
    return { ok: true, status: 200, json: async () => ({ data: tags.map((t) => ({ id: t })) }) };
  });
}

beforeEach(() => {
  nodeStore.nodes = [];
  invalidateLocalModelIndex();
});
afterEach(() => { globalThis.fetch = REAL_FETCH; });

describe("the namespace scheme", () => {
  it("a single node keeps the bare namespace — every existing id still works", async () => {
    nodeStore.nodes.push(REAL);
    globalThis.fetch = tagFetch({ "127.0.0.1:11434": ["qwen3.5:4b", "llama3.1:8b"] });
    const index = await getLocalModelIndex();
    expect(index.entries.map((e) => e.id)).toEqual(["ollama/qwen3.5:4b", "ollama/llama3.1:8b"]);
  });

  it("a SECOND node serving the same tag gets its own namespace and cannot shadow the first", async () => {
    nodeStore.nodes.push(REAL, EVIL);
    globalThis.fetch = tagFetch({
      "127.0.0.1:11434": ["qwen3.5:4b"],
      "127.0.0.1:20369": ["qwen3.5:4b"],
    });
    const index = await getLocalModelIndex();
    const ids = index.entries.map((e) => e.id);
    expect(ids).toContain("ollama/qwen3.5:4b");
    expect(ids).toContain("ollama@127-0-0-1-20369/qwen3.5:4b");
    // The bare id belongs to the node registered FIRST, whatever order the DB
    // hands them back in. This is the whole of C1: the second registration can
    // no longer take delivery of prompts addressed to the first.
    expect(index.byId.get("ollama/qwen3.5:4b").node.id).toBe("real");
  });

  it("the owner is decided loopback-first, then by earliest registration", () => {
    // Registered EARLIER but remote; loopback still wins.
    const owners = ownerNodeIdFor([{ ...REMOTE, createdAt: "2020-01-01T00:00:00.000Z" }, REAL]);
    expect(owners.get("ollama")).toBe("real");
    // Among two remotes, the earlier registration wins.
    const remoteOnly = ownerNodeIdFor([
      { ...REMOTE, id: "later", createdAt: "2026-05-01T00:00:00.000Z" },
      { ...REMOTE, id: "earlier", baseUrl: "http://10.0.11.3:11434", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(remoteOnly.get("ollama")).toBe("earlier");
  });

  it("the owner does not change when a node is added AFTER it", async () => {
    nodeStore.nodes.push(REAL);
    globalThis.fetch = tagFetch({ "127.0.0.1:11434": ["qwen3.5:4b"], "10.0.11.2:11434": ["qwen3.5:4b"] });
    expect((await getLocalModelIndex()).byId.get("ollama/qwen3.5:4b").node.id).toBe("real");

    nodeStore.nodes.push(REMOTE);
    invalidateLocalModelIndex();
    expect((await getLocalModelIndex()).byId.get("ollama/qwen3.5:4b").node.id).toBe("real");
  });

  it("the node-scoped slug is derived from host:port, so it survives a restart", () => {
    expect(nodeSlug(REMOTE)).toBe("10-0-11-2-11434");
    expect(nodeSlug({ baseUrl: "http://[::1]:1234" })).toBe("1-1234");
    expect(prefixForNode(REMOTE, "someone-else")).toBe("ollama@10-0-11-2-11434");
    expect(prefixForNode(REMOTE, REMOTE.id)).toBe("ollama");
    // Legacy single-node call sites keep the bare namespace.
    expect(prefixForNode(REMOTE)).toBe("ollama");
    expect(baseNamespaceFor({ apiType: "openai" })).toBe("lmstudio");
  });

  it("an lmstudio node and an ollama node do not compete for one namespace", async () => {
    nodeStore.nodes.push(REAL, { id: "lms", type: "local", apiType: "openai", baseUrl: "http://127.0.0.1:1234/v1", createdAt: "2026-03-01T00:00:00.000Z" });
    globalThis.fetch = tagFetch({ "127.0.0.1:11434": ["m"], "127.0.0.1:1234": ["m"] });
    const ids = (await getLocalModelIndex()).entries.map((e) => e.id);
    expect(ids).toContain("ollama/m");
    expect(ids).toContain("lmstudio/m");
  });
});

describe("bare-tag resolution (C1d)", () => {
  it("routes a shadowed tag to the LOOPBACK node, not the newcomer", async () => {
    nodeStore.nodes.push(REAL, REMOTE);
    globalThis.fetch = tagFetch({ "127.0.0.1:11434": ["qwen3.5:4b"], "10.0.11.2:11434": ["qwen3.5:4b"] });
    const resolved = await resolveBareModelId("qwen3.5:4b");
    expect(resolved).toBe("ollama/qwen3.5:4b");
    const index = await getLocalModelIndex();
    expect(index.byId.get(resolved).node.baseUrl).toBe("http://127.0.0.1:11434");
  });

  it("does not go null just because a second node showed up (the bare-tag DoS)", async () => {
    nodeStore.nodes.push(REAL);
    globalThis.fetch = tagFetch({ "127.0.0.1:11434": ["qwen3.5:4b"], "10.0.11.2:11434": ["qwen3.5:4b"] });
    expect(await resolveBareModelId("qwen3.5:4b")).toBe("ollama/qwen3.5:4b");

    nodeStore.nodes.push(REMOTE);
    invalidateLocalModelIndex();
    expect(await resolveBareModelId("qwen3.5:4b")).toBe("ollama/qwen3.5:4b");
  });

  it("is null only when the tag is genuinely ambiguous among remote nodes", async () => {
    nodeStore.nodes.push(REMOTE, { id: "r2", type: "local", apiType: "ollama", baseUrl: "http://10.0.11.3:11434", createdAt: "2026-03-01T00:00:00.000Z" });
    globalThis.fetch = tagFetch({ "10.0.11.2:11434": ["shared"], "10.0.11.3:11434": ["shared"] });
    expect(await resolveBareModelId("shared")).toBeNull();
  });

  it("a tag only a non-owner serves resolves to the node-scoped id", async () => {
    nodeStore.nodes.push(REAL, REMOTE);
    globalThis.fetch = tagFetch({ "127.0.0.1:11434": ["qwen3.5:4b"], "10.0.11.2:11434": ["only-remote"] });
    expect(await resolveBareModelId("only-remote")).toBe("ollama@10-0-11-2-11434/only-remote");
  });
});

describe("H1 — the index caps what a node can publish into /v1/models", () => {
  it("drops ids with control characters and caps the list", async () => {
    nodeStore.nodes.push(REAL);
    const many = Array.from({ length: 900 }, (_, i) => `m${i}`);
    globalThis.fetch = tagFetch({ "127.0.0.1:11434": ["ok:1", "bad\nid", "x".repeat(300), ...many] });
    const index = await getLocalModelIndex();
    expect(index.entries.length).toBe(500);
    expect(index.entries.map((e) => e.tag)).toContain("ok:1");
    expect(index.entries.map((e) => e.tag)).not.toContain("bad\nid");
  });
});

/**
 * The ROUTING half of C1.
 *
 * Namespacing the ids stops a shadow node from PUBLISHING `ollama/<tag>`. It
 * does not, on its own, stop it from being ROUTED to: every `apiType:"ollama"`
 * node gets a `provider:"ollama"` connection from `syncLocalProviderConnection`,
 * and RoutingEngine.findRoute gathered every connection for the provider as a
 * candidate. Verified against the standalone build after the namespacing landed
 * and BEFORE this: a shadow node still answered
 * `POST /v1/chat/completions {"model":"qwen3.5:4b"}` with its own content.
 */
describe("resolveLocalRouteTarget — one id, one node", () => {
  it("maps the bare namespace to the OWNER node", async () => {
    nodeStore.nodes.push(REAL, EVIL);
    const pin = await resolveLocalRouteTarget("ollama/qwen3.5:4b");
    expect(pin).toEqual({ providerId: "ollama", tag: "qwen3.5:4b", nodeId: "real", namespaced: false });
  });

  it("maps a node-scoped id to that node and nothing else", async () => {
    nodeStore.nodes.push(REAL, EVIL);
    const pin = await resolveLocalRouteTarget("ollama@127-0-0-1-20369/qwen3.5:4b");
    expect(pin).toEqual({ providerId: "ollama", tag: "qwen3.5:4b", nodeId: "evil", namespaced: true });
  });

  it("keeps a tag containing slashes intact", async () => {
    nodeStore.nodes.push(REAL);
    const pin = await resolveLocalRouteTarget("ollama/hf.co/ruv/model:q4_K_M");
    expect(pin.tag).toBe("hf.co/ruv/model:q4_K_M");
    expect(pin.nodeId).toBe("real");
  });

  it("reads the NODE LIST, not the probe index — a runtime that is down still pins", async () => {
    nodeStore.nodes.push(REAL, EVIL);
    globalThis.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    expect((await getLocalModelIndex()).entries).toEqual([]);
    expect((await resolveLocalRouteTarget("ollama/qwen3.5:4b")).nodeId).toBe("real");
  });

  it("pins a provider ALIAS too, so `ol/…` is not a way round the pin", async () => {
    nodeStore.nodes.push(REAL, EVIL);
    const pin = await resolveLocalRouteTarget("ol/qwen3.5:4b");
    expect(pin).toEqual({ providerId: "ollama", tag: "qwen3.5:4b", nodeId: "real", namespaced: false });
  });

  it("is null for anything that is not a local-runtime id", async () => {
    nodeStore.nodes.push(REAL);
    expect(await resolveLocalRouteTarget("openai/gpt-4o")).toBeNull();
    expect(await resolveLocalRouteTarget("auto")).toBeNull();
    expect(await resolveLocalRouteTarget("qwen3.5:4b")).toBeNull();
    expect(await resolveLocalRouteTarget("")).toBeNull();
    expect(await resolveLocalRouteTarget(null)).toBeNull();
    expect(await resolveLocalRouteTarget("ollama/")).toBeNull();
  });

  it("reports nodeId:null when the slug names no registered node", async () => {
    nodeStore.nodes.push(REAL);
    expect((await resolveLocalRouteTarget("ollama@1-2-3-4-9999/x")).nodeId).toBeNull();
  });
});

describe("pickLocalDefaultModel still works with namespacing", () => {
  it("prefers the namespace owner's chat model", async () => {
    nodeStore.nodes.push(REAL, REMOTE);
    globalThis.fetch = tagFetch({
      "127.0.0.1:11434": ["nomic-embed-text:latest", "qwen3.5:4b"],
      "10.0.11.2:11434": ["remote-model"],
    });
    expect(await pickLocalDefaultModel("ollama")).toBe("qwen3.5:4b");
  });

  it("falls back to a non-owner node when the owner serves nothing usable", async () => {
    nodeStore.nodes.push(REAL, REMOTE);
    globalThis.fetch = tagFetch({ "127.0.0.1:11434": [], "10.0.11.2:11434": ["remote-model"] });
    expect(await pickLocalDefaultModel("ollama")).toBe("remote-model");
  });
});
