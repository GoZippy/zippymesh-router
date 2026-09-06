/**
 * The route-level guard and the SSRF gate on `POST /api/provider-nodes`
 * (adversarial review 2026-08-30, findings C1a, C1b and H1).
 *
 * What was wrong, verified end-to-end against the standalone build:
 *
 *  - **No route-level auth at all.** `src/middleware.js:120-129` says its edge
 *    check proves key AUTHENTICITY only and that "Sensitive management routes
 *    MUST add their own route-level guard — do not rely on this edge check
 *    alone." This route drives arbitrary outbound `fetch()` and mints routing
 *    targets, and had neither `requireAuth`, `checkAuth` nor `requireApiKey`.
 *
 *  - **`type:"local"` was a naming convention, not a constraint.** Any parseable
 *    host was accepted and probed. Reproduced: an attacker HTTP server on
 *    127.0.0.1:20369 answering `/api/tags` with `{"models":[{"name":"qwen3.5:4b"}]}`
 *    was registered as a "local" node, and the very next
 *    `POST /v1/chat/completions {"model":"qwen3.5:4b"}` was answered by it —
 *    `{"content":"I AM THE ATTACKER SERVER","model":"ollama/qwen3.5:4b"}` — with
 *    the operator's prompt delivered to the attacker's log.
 *
 *  - **A three-state port/firewall oracle.** The probe's failure text was echoed
 *    verbatim, so `fetch failed` / `timed out after 5000ms` / `HTTP 401` told a
 *    caller refused-vs-dropped-vs-open-and-answering for any host the ZMLR
 *    process could reach. Reproduced against 127.0.0.1:20399 (closed),
 *    169.254.169.254 (link-local, dropped) and a host answering 401.
 *
 *  - **Model-list exfiltration.** Anything shaped `.models[].name` was published
 *    into `/v1/models`; the review got `ollama/SECRET-AWS-KEY-AKIAI0SECRET` and
 *    `internal-host-db01.corp.local` listed that way.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreateProviderNode, mockGetProviderNodes, mockGetSettings, mockGetSessionClaims, nodeStore, settingsStore } = vi.hoisted(() => {
  const nodeStore = { nodes: [] };
  const settingsStore = { requireLogin: true };
  return {
    nodeStore,
    settingsStore,
    mockGetProviderNodes: vi.fn(async () => nodeStore.nodes.slice()),
    mockGetSettings: vi.fn(async () => ({ ...settingsStore })),
    mockGetSessionClaims: vi.fn(async () => null),
    mockCreateProviderNode: vi.fn(async (data) => {
      const node = { id: `node-${nodeStore.nodes.length + 1}`, createdAt: new Date(2026, 0, nodeStore.nodes.length + 1).toISOString(), ...data };
      nodeStore.nodes.push(node);
      return node;
    }),
  };
});

vi.mock("../../src/lib/localDb.js", () => ({
  createProviderNode: mockCreateProviderNode,
  getProviderNodes: mockGetProviderNodes,
  getNodeIdentity: vi.fn(async () => ({ publicKey: "PUB" })),
  getSettings: mockGetSettings,
}));

vi.mock("../../src/models/index.js", () => ({
  createProviderNode: mockCreateProviderNode,
  getProviderNodes: mockGetProviderNodes,
}));

vi.mock("../../src/lib/security.js", () => ({
  signPayload: vi.fn(async () => "jwt"),
  verifyPayload: vi.fn(async () => ({})),
}));

// `isAuthenticated` reads the request cookie via next/headers, which has no
// meaning outside a Next request scope. Drive it directly instead: `false` is
// "no session", which is the state the C1 drive-by was in.
const { mockIsAuthenticated } = vi.hoisted(() => ({ mockIsAuthenticated: vi.fn(async () => false) }));
vi.mock("../../src/lib/auth/login.js", () => ({ isAuthenticated: mockIsAuthenticated }));

vi.mock("../../src/lib/auth/middleware.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getSessionClaims: mockGetSessionClaims };
});

import { POST, GET } from "../../src/app/api/provider-nodes/route.js";
import { PROBE_FAILURE, probeLocalRuntime, sanitizeModelIds, registerLocalRuntime } from "../../src/lib/discovery/localDiscovery.js";
import {
  classifyHostnameSync,
  isLoopbackUrl,
  checkRegistrationTarget,
} from "../../src/lib/routing/hostClass.js";
import { invalidateLocalModelIndex } from "../../src/lib/routing/localModelIndex.js";

const REAL_FETCH = globalThis.fetch;

/** Answers /api/tags for whatever host:port we declare "up". */
function fakeFetch(up = {}) {
  return vi.fn(async (url) => {
    const u = new URL(String(url));
    const key = `${u.hostname}:${u.port || "80"}`;
    const models = up[key];
    if (!models) throw new Error("ECONNREFUSED");
    return { ok: true, status: 200, json: async () => ({ models: models.map((n) => ({ name: n })) }) };
  });
}

function req(body) {
  return new Request("http://127.0.0.1:20128/api/provider-nodes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function message(res) {
  const b = await res.json();
  return String(b?.error?.message ?? b?.error ?? "");
}

beforeEach(() => {
  nodeStore.nodes = [];
  settingsStore.requireLogin = true;
  mockIsAuthenticated.mockResolvedValue(false);
  mockGetSessionClaims.mockResolvedValue(null);
  mockCreateProviderNode.mockClear();
  invalidateLocalModelIndex();
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

// ─── C1a: the route-level guard ──────────────────────────────────────────────

describe("C1a — POST /api/provider-nodes has a route-level auth guard", () => {
  it("401s an unauthenticated caller instead of probing and registering", async () => {
    globalThis.fetch = fakeFetch({ "127.0.0.1:11434": ["qwen3.5:4b"] });
    const res = await POST(req({ type: "local", apiType: "ollama", baseUrl: "http://127.0.0.1:11434" }));
    expect(res.status).toBe(401);
    // The point: no outbound fetch, no node. The guard runs BEFORE the probe.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockCreateProviderNode).not.toHaveBeenCalled();
  });

  it("401s the CSRF-shaped drive-by (no cookie, foreign Origin, text/plain)", async () => {
    globalThis.fetch = fakeFetch({ "127.0.0.1:20369": ["qwen3.5:4b"] });
    // A CORS *simple* request: no preflight, so a hostile page can issue it.
    const drive = new Request("http://127.0.0.1:20128/api/provider-nodes", {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8", origin: "https://evil.example.com" },
      body: JSON.stringify({ type: "local", apiType: "ollama", baseUrl: "http://127.0.0.1:20369" }),
    });
    expect((await POST(drive)).status).toBe(401);
    expect(mockCreateProviderNode).not.toHaveBeenCalled();
  });

  it("401s GET too — the node list carries every runtime's baseUrl", async () => {
    expect((await GET(new Request("http://127.0.0.1:20128/api/provider-nodes"))).status).toBe(401);
  });

  it("lets an authenticated caller through", async () => {
    mockIsAuthenticated.mockResolvedValue({ authenticated: true, role: "admin" });
    globalThis.fetch = fakeFetch({ "127.0.0.1:11434": ["qwen3.5:4b"] });
    const res = await POST(req({ type: "local", apiType: "ollama", baseUrl: "http://127.0.0.1:11434" }));
    expect(res.status).toBe(201);
  });

  it("open mode (requireLogin:false) still passes — which is why the host gate is not optional", async () => {
    settingsStore.requireLogin = false;
    globalThis.fetch = fakeFetch({ "127.0.0.1:11434": ["qwen3.5:4b"] });
    const res = await POST(req({ type: "local", apiType: "ollama", baseUrl: "http://127.0.0.1:11434" }));
    expect(res.status).toBe(201);
  });
});

// ─── C1b / H1: the host allow-list ───────────────────────────────────────────

describe("hostClass — the trust boundary itself", () => {
  it("classifies the loopback set", () => {
    for (const h of ["127.0.0.1", "127.5.6.7", "localhost", "::1", "0.0.0.0", "::"]) {
      expect(classifyHostnameSync(h)).toBe("loopback");
    }
  });

  it("classifies RFC1918 as private and everything else as public", () => {
    expect(classifyHostnameSync("10.0.11.2")).toBe("private");
    expect(classifyHostnameSync("172.16.0.1")).toBe("private");
    expect(classifyHostnameSync("172.32.0.1")).toBe("public");
    expect(classifyHostnameSync("192.168.1.50")).toBe("private");
    expect(classifyHostnameSync("93.184.216.34")).toBe("public");
    expect(classifyHostnameSync("8.8.8.8")).toBe("public");
  });

  it("classifies the cloud metadata range as link-local", () => {
    expect(classifyHostnameSync("169.254.169.254")).toBe("link-local");
    expect(classifyHostnameSync("fe80::1")).toBe("link-local");
  });

  it("M9: isLoopbackUrl parses the URL instead of substring-matching it", () => {
    expect(isLoopbackUrl("http://127.0.0.1:11434")).toBe(true);
    expect(isLoopbackUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:11434")).toBe(true);
    // The two the old `baseUrl.includes("127.0.0.1")` helper called loopback.
    expect(isLoopbackUrl("http://127.0.0.1.evil.com/")).toBe(false);
    expect(isLoopbackUrl("http://localhost.evil.com/")).toBe(false);
    expect(isLoopbackUrl("http://evil.com/?x=127.0.0.1")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });

  it("refuses a public address outright, even with allowRemote from an admin", async () => {
    const gate = await checkRegistrationTarget("http://93.184.216.34:80", { allowRemote: true, isAdmin: true });
    expect(gate.allowed).toBe(false);
    expect(gate.hostClass).toBe("public");
  });

  it("refuses link-local by default and allows it only for an admin who opts in", async () => {
    expect((await checkRegistrationTarget("http://169.254.169.254/", {})).allowed).toBe(false);
    expect((await checkRegistrationTarget("http://169.254.169.254/", { allowRemote: true, isAdmin: false })).allowed).toBe(false);
    expect((await checkRegistrationTarget("http://169.254.169.254/", { allowRemote: true, isAdmin: true })).allowed).toBe(true);
  });

  it("allows the classes a real local runtime lives on", async () => {
    for (const url of ["http://127.0.0.1:11434", "http://10.0.11.2:11434", "http://192.168.1.50:1234", "http://nas.local:11434"]) {
      expect((await checkRegistrationTarget(url, {})).allowed).toBe(true);
    }
  });
});

describe("C1b / H1 — the route refuses a non-local baseUrl", () => {
  beforeEach(() => {
    mockIsAuthenticated.mockResolvedValue({ authenticated: true, role: "admin" });
  });

  it("403s a public host and never fetches it", async () => {
    globalThis.fetch = fakeFetch({ "93.184.216.34:80": ["anything"] });
    const res = await POST(req({ type: "local", apiType: "ollama", baseUrl: "http://93.184.216.34:80" }));
    expect(res.status).toBe(403);
    expect(await message(res)).toMatch(/public address/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockCreateProviderNode).not.toHaveBeenCalled();
  });

  it("403s https://api.openai.com — the review's HTTP-status oracle probe", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const res = await POST(req({ type: "local", apiType: "openai-compatible", baseUrl: "https://api.openai.com" }));
    expect(res.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("403s 169.254.169.254 without spending the 5 s timeout on it", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("should not be called"); });
    const res = await POST(req({ type: "local", apiType: "ollama", baseUrl: "http://169.254.169.254/latest/meta-data" }));
    expect(res.status).toBe(403);
    expect(await message(res)).toMatch(/link-local/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("still registers the loopback runtime the feature exists for", async () => {
    globalThis.fetch = fakeFetch({ "127.0.0.1:11434": ["qwen3.5:4b"] });
    const res = await POST(req({ type: "local", apiType: "ollama", baseUrl: "http://127.0.0.1:11434" }));
    expect(res.status).toBe(201);
    expect((await res.json()).modelIds).toContain("ollama/qwen3.5:4b");
  });
});

// ─── H1: no oracle, no exfiltration ──────────────────────────────────────────

describe("H1 — the probe reports a failure CLASS, never the upstream detail", () => {
  it("collapses a refused connection to `unreachable`", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:20399"); });
    const probed = await probeLocalRuntime("http://127.0.0.1:20399", "ollama", 500);
    expect(probed.error).toBe(PROBE_FAILURE.UNREACHABLE);
    expect(JSON.stringify(probed)).not.toMatch(/ECONNREFUSED/);
  });

  it("collapses an upstream status to `unexpected_status`, never the number", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const probed = await probeLocalRuntime("http://127.0.0.1:1234", "lmstudio", 500);
    expect(probed.error).toBe(PROBE_FAILURE.UNEXPECTED_STATUS);
    expect(probed.error).not.toMatch(/401/);
  });

  it("reports `timeout` for an abort, and does NOT say how long it waited", async () => {
    globalThis.fetch = vi.fn((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => {
        const e = new Error("aborted"); e.name = "AbortError"; reject(e);
      });
    }));
    const probed = await probeLocalRuntime("http://127.0.0.1:1", "ollama", 250);
    expect(probed.error).toBe(PROBE_FAILURE.TIMEOUT);
    expect(probed.error).not.toMatch(/\d+ms/);
  });

  it("the 502 the route returns names the URL and the class, nothing else", async () => {
    mockIsAuthenticated.mockResolvedValue({ authenticated: true, role: "admin" });
    globalThis.fetch = vi.fn(async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:20399"); });
    const res = await POST(req({ type: "local", apiType: "ollama", baseUrl: "http://127.0.0.1:20399" }));
    expect(res.status).toBe(502);
    const msg = await message(res);
    // The e2e suite pins this prefix; keep it.
    expect(msg).toMatch(/^No Ollama runtime responded at http:\/\/127\.0\.0\.1:20399\/api\/tags/);
    expect(msg).toContain("unreachable");
    expect(msg).not.toMatch(/ECONNREFUSED|fetch failed|HTTP \d/);
  });

  it("M8: an abort DURING the body read fails closed instead of reporting a healthy node", async () => {
    // Was: the inner catch swallowed the AbortError and the function returned
    // `ok:true`, so the node was registered as healthy.
    globalThis.fetch = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      body: null,
      json: async () => {
        init.signal.dispatchEvent?.(new Event("abort"));
        const e = new Error("aborted"); e.name = "AbortError"; throw e;
      },
      text: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; },
    }));
    // Force the abort by using a timeout the fake outlives.
    const controllerAbortingFetch = vi.fn(async (url, init) => {
      init.signal.addEventListener?.("abort", () => {});
      await new Promise((r) => setTimeout(r, 400));
      return {
        ok: true, status: 200, body: null,
        text: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; },
      };
    });
    globalThis.fetch = controllerAbortingFetch;
    const probed = await probeLocalRuntime("http://127.0.0.1:11434", "ollama", 250);
    expect(probed.ok).toBe(false);
  });
});

describe("H1 — the model list a rejected host can publish is bounded and sanitised", () => {
  it("keeps ordinary tags", () => {
    expect(sanitizeModelIds(["qwen3.5:4b", "nomic-embed-text:latest", "hf.co/ruv/x:q4_K_M"]))
      .toEqual(["qwen3.5:4b", "nomic-embed-text:latest", "hf.co/ruv/x:q4_K_M"]);
  });

  it("drops non-strings, control characters, newlines and over-long ids", () => {
    expect(sanitizeModelIds([
      null, 42, {}, "",
      "has\nnewline",
      "has nul",
      "x".repeat(129),
    ])).toEqual([]);
    expect(sanitizeModelIds(["x".repeat(128)]).length).toBe(1);
  });

  it("caps the list at 500 ids", () => {
    const many = Array.from({ length: 900 }, (_, i) => `m${i}`);
    expect(sanitizeModelIds(many).length).toBe(500);
  });
});

// ─── registerLocalRuntime is gated even when called directly ─────────────────

describe("registerLocalRuntime enforces the gate itself, not just via the route", () => {
  it("403s a public target with a caller-safe reason", async () => {
    globalThis.fetch = fakeFetch({});
    const out = await registerLocalRuntime({ baseUrl: "http://93.184.216.34", apiType: "ollama" });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(out.hostClass).toBe("public");
    expect(mockCreateProviderNode).not.toHaveBeenCalled();
  });

  it("skipHostCheck is honoured only for the interface-derived LAN sweep", async () => {
    globalThis.fetch = fakeFetch({});
    const out = await registerLocalRuntime({
      baseUrl: "http://93.184.216.34", apiType: "ollama", probe: false, models: ["x"], skipHostCheck: true,
    });
    expect(out.ok).toBe(true);
  });
});
