/**
 * The prompt cache's TENANT dimension (adversarial review 2026-08-30, H3).
 *
 * `computePromptHash` hashed the request body and nothing else — no API key, no
 * virtual key, no user, no session — and `user`, the one body field that could
 * have carried a caller identity, was explicitly on the ignore list.
 * `getCacheEntry(hash)` then read one global table.
 *
 * Reproduced live against the standalone build: a prompt was sent with NO
 * credentials, and was then served to two unrelated bearer identities that had
 * never sent it —
 *
 *     Authorization: Bearer tenant-A-key-…  -> x-cache: HIT  model=ollama/qwen3.5:4b
 *     Authorization: Bearer tenant-B-key-…  -> x-cache: HIT  model=ollama/qwen3.5:4b
 *
 * Two consequences: answer sharing (replay another caller's exact body, get
 * their stored answer) and an existence oracle (`x-cache: HIT` confirms that
 * someone on this install has run an exact prompt).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/localDb.js", () => ({
  getCacheEntry: vi.fn(), setCacheEntry: vi.fn(), getCacheStats: vi.fn(),
  purgeExpiredCache: vi.fn(), getCacheEmbedding: vi.fn(), setCacheEmbedding: vi.fn(),
  getAllCacheEmbeddings: vi.fn(() => []), getSettings: vi.fn(async () => ({})),
}));

import {
  ANONYMOUS_TENANT,
  computePromptHash,
  tenantIdFor,
  tenantIdForRequest,
} from "../../src/lib/promptCache.js";

const BODY = {
  model: "ollama/qwen3.5:4b",
  messages: [{ role: "user", content: "reply with the number 7" }],
  max_tokens: 64,
  temperature: 0,
};

function bearerRequest(token) {
  return new Request("http://127.0.0.1:20128/v1/chat/completions", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  process.env.JWT_SECRET = "unit-test-secret";
});

describe("tenantIdFor", () => {
  it("gives an uncredentialed caller the shared anonymous bucket", () => {
    expect(tenantIdFor({})).toBe(ANONYMOUS_TENANT);
    expect(tenantIdFor({ bearer: "" })).toBe(ANONYMOUS_TENANT);
    expect(tenantIdFor({ bearer: "   " })).toBe(ANONYMOUS_TENANT);
  });

  it("prefers a resolved virtual key id over the raw bearer", () => {
    expect(tenantIdFor({ virtualKeyId: "vk-uuid", bearer: "zm_live_abc" })).toBe("vk:vk-uuid");
  });

  it("never puts the raw credential in the tenant id", () => {
    const raw = "tenant-A-key-supersecret";
    const id = tenantIdFor({ bearer: raw });
    expect(id.startsWith("key:")).toBe(true);
    expect(id).not.toContain(raw);
    expect(id).not.toContain("supersecret");
    // HMAC-SHA256 truncated to 32 hex chars.
    expect(id.slice(4)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is stable for the same key and different for a different key", () => {
    expect(tenantIdFor({ bearer: "k1" })).toBe(tenantIdFor({ bearer: "k1" }));
    expect(tenantIdFor({ bearer: "k1" })).not.toBe(tenantIdFor({ bearer: "k2" }));
  });

  it("is install-scoped: the same key on another install hashes differently", () => {
    const a = tenantIdFor({ bearer: "k1" });
    process.env.JWT_SECRET = "a-completely-different-install";
    expect(tenantIdFor({ bearer: "k1" })).not.toBe(a);
  });

  it("reads the Authorization header off a Request", () => {
    expect(tenantIdForRequest(bearerRequest(null))).toBe(ANONYMOUS_TENANT);
    expect(tenantIdForRequest(bearerRequest("k1"))).toBe(tenantIdFor({ bearer: "k1" }));
    expect(tenantIdForRequest(bearerRequest("zm_live_x"), "vk-1")).toBe("vk:vk-1");
    // A header-less object must not throw.
    expect(tenantIdForRequest({})).toBe(ANONYMOUS_TENANT);
  });
});

describe("computePromptHash is tenant-scoped", () => {
  it("H3: two identities never share an entry for the same body", () => {
    const anon = computePromptHash(BODY, ANONYMOUS_TENANT);
    const a = computePromptHash(BODY, tenantIdFor({ bearer: "tenant-A-key" }));
    const b = computePromptHash(BODY, tenantIdFor({ bearer: "tenant-B-key" }));
    expect(new Set([anon, a, b]).size).toBe(3);
  });

  it("a virtual key and a router key with the same body do not collide", () => {
    expect(computePromptHash(BODY, tenantIdFor({ virtualKeyId: "vk-1" })))
      .not.toBe(computePromptHash(BODY, tenantIdFor({ bearer: "zm_live_x" })));
  });

  it("the SAME identity still hits — the cache is scoped, not disabled", () => {
    const t = tenantIdFor({ bearer: "tenant-A-key" });
    expect(computePromptHash(BODY, t)).toBe(computePromptHash(BODY, t));
    // Key order in the body still does not matter (the v2 canonicalisation).
    const reordered = { temperature: 0, max_tokens: 64, messages: BODY.messages, model: BODY.model };
    expect(computePromptHash(reordered, t)).toBe(computePromptHash(BODY, t));
  });

  it("the body still fully determines the key within one tenant", () => {
    const t = tenantIdFor({ bearer: "k" });
    expect(computePromptHash({ ...BODY, response_format: { type: "json_object" } }, t))
      .not.toBe(computePromptHash(BODY, t));
  });

  it("omitting the tenant means anonymous, so every legacy call site is safe", () => {
    expect(computePromptHash(BODY)).toBe(computePromptHash(BODY, ANONYMOUS_TENANT));
  });

  it("the key version was bumped, so v2 entries can never be served against a v3 key", () => {
    // v2 hashed {v:"v2", body:…}; v3 hashes {v:"v3", t:…, body:…}. Recomputing
    // the v2 shape by hand must not equal what the function produces now.
    const crypto = require("crypto");
    const v2 = crypto.createHash("sha256")
      .update(JSON.stringify({ v: "v2", body: { max_tokens: 64, messages: BODY.messages, model: BODY.model, temperature: 0 } }))
      .digest("hex");
    expect(computePromptHash(BODY, ANONYMOUS_TENANT)).not.toBe(v2);
  });
});
