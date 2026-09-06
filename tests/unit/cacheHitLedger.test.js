/**
 * A prompt-cache HIT must be accounted for (adversarial review 2026-08-30, H4).
 *
 * The HIT path returned at `route.js:226-229`, before `handleChat()`, so it
 * skipped `saveRequestTrace`, `saveRoutingDecision`, `recordSlaEvent`,
 * `dispatchWebhookEvent`, the token ledger AND `updateVirtualKeyUsage`.
 *
 * Verified against the live SQLite ledger: eight billable requests produced six
 * `token_ledger` rows; the two missing ones were exactly the two `x-cache: HIT`
 * responses. `checkVirtualKeyBudget` still ran on the way in, but the counter it
 * reads never advanced — so a caller with a token or dollar budget could replay
 * any cacheable prompt without limit and the budget could never trip.
 *
 * `token_ledger.provider` and `.status` are free-text columns
 * (src/lib/localDb.js:588-601), so `provider:"cache"` / `status:"cache_hit"`
 * needs no migration: `getTokenUsageSummary()` filters `status = 'success'` and
 * keeps its old meaning, while replay volume becomes queryable for the first
 * time.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  ledger: [],
  keyUsage: new Map(),
  cache: new Map(),
  virtualKeys: new Map(),
  webhooks: [],
}));

vi.mock("../../src/lib/localDb.js", () => ({
  recordTokenUsage: vi.fn((row) => { h.ledger.push(row); }),
  updateVirtualKeyUsage: vi.fn((id, { tokensUsed = 0, dollarCost = 0 }) => {
    const cur = h.keyUsage.get(id) || { tokens: 0, dollars: 0 };
    h.keyUsage.set(id, { tokens: cur.tokens + tokensUsed, dollars: cur.dollars + dollarCost });
  }),
  getVirtualKeyByHash: vi.fn((hash) => h.virtualKeys.get(hash) || null),
  checkVirtualKeyBudget: vi.fn(() => ({ allowed: true, reason: null })),
  getSettings: vi.fn(async () => ({})),
  saveRoutingDecision: vi.fn(),
  saveRequestTrace: vi.fn(),
  recordSlaEvent: vi.fn(),
  updateModelPreference: vi.fn(),
  // promptCache.js re-exports these two, so the mock has to carry them even
  // though nothing here calls them.
  getCacheStats: vi.fn(),
  purgeExpiredCache: vi.fn(),
  getCacheEntry: vi.fn(),
  setCacheEntry: vi.fn(),
  getCacheEmbedding: vi.fn(),
  setCacheEmbedding: vi.fn(),
  getAllCacheEmbeddings: vi.fn(() => []),
}));

vi.mock("../../src/lib/promptCache.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // The store is keyed on the REAL hash, so the tenant scoping (H3) is
    // exercised end-to-end through the route rather than stubbed away.
    tryGetCache: vi.fn((hash) => {
      const hit = h.cache.get(hash);
      return hit ? JSON.parse(JSON.stringify(hit)) : null;
    }),
    storeInCache: vi.fn((hash, model, body) => { h.cache.set(hash, body); }),
    trySemanticCache: vi.fn(async () => null),
    storeEmbedding: vi.fn(async () => {}),
  };
});

vi.mock("../../src/lib/logExporter.js", () => ({
  dispatchWebhookEvent: vi.fn((kind, payload) => { h.webhooks.push({ kind, payload }); }),
}));

vi.mock("../../src/sse/handlers/chat.js", () => ({
  handleChat: vi.fn(async () => new Response(JSON.stringify(MISS_BODY), {
    status: 200, headers: { "content-type": "application/json" },
  })),
}));

vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn(async () => {}) }));
vi.mock("../../src/lib/sidecar/index.js", () => ({ proxyChatCompletion: vi.fn() }));
vi.mock("../../src/shared/utils/cloud.js", () => ({ callCloudWithMachineId: vi.fn() }));
vi.mock("../../src/lib/routing/localModelIndex.js", () => ({ resolveBareModelId: vi.fn(async () => null) }));
vi.mock("../../src/lib/auth/apiKey.js", () => ({ getClientIp: vi.fn(() => "direct") }));
vi.mock("../../src/lib/auth/ipRateLimit.js", () => ({ checkIpRateLimit: vi.fn(() => ({ allowed: true, resetAt: Date.now() + 1000 })) }));

const MISS_BODY = {
  id: "chatcmpl-real",
  object: "chat.completion",
  created: 1,
  model: "ollama/qwen3.5:4b",
  choices: [{ index: 0, message: { role: "assistant", content: "7" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 23, completion_tokens: 64, total_tokens: 87 },
};

import crypto from "crypto";
import { POST } from "../../src/app/api/v1/chat/completions/route.js";
import { computePromptHash, tenantIdFor } from "../../src/lib/promptCache.js";

const BODY = {
  model: "ollama/qwen3.5:4b",
  messages: [{ role: "user", content: "reply with the number 7" }],
  max_tokens: 64,
  temperature: 0,
};

function chat(headers = {}) {
  return POST(new Request("http://127.0.0.1:20128/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(BODY),
  }));
}

/** Register a virtual key the route will resolve from `Authorization`. */
function mintVirtualKey(raw, id) {
  h.virtualKeys.set(crypto.createHash("sha256").update(raw).digest("hex"), { id, name: "k" });
  return raw;
}

beforeEach(() => {
  h.ledger.length = 0;
  h.webhooks.length = 0;
  h.keyUsage.clear();
  h.cache.clear();
  h.virtualKeys.clear();
  process.env.JWT_SECRET = "unit-test-secret";
});

describe("H4 — a cache HIT is written to the token ledger", () => {
  it("N hits produce N rows", async () => {
    const first = await chat();
    expect(first.status).toBe(200);
    expect(first.headers.get("x-cache")).toBeNull();
    // The MISS's cache write is fire-and-forget off a cloned response.
    await new Promise((r) => setTimeout(r, 50));
    const rowsAfterMiss = h.ledger.length;

    for (let i = 0; i < 3; i++) {
      const hit = await chat();
      expect(hit.headers.get("x-cache")).toBe("HIT");
    }
    expect(h.ledger.length - rowsAfterMiss).toBe(3);
  });

  it("the row says it was a replay, not a provider call", async () => {
    await chat();
    await new Promise((r) => setTimeout(r, 50));
    h.ledger.length = 0;

    await chat();
    expect(h.ledger).toHaveLength(1);
    const row = h.ledger[0];
    expect(row.provider).toBe("cache");
    expect(row.status).toBe("cache_hit");
    expect(row.latencyMs).toBe(0);
    expect(row.costUsd).toBe(0);
    // The QUALIFIED id the response reports, so the row joins against the same
    // id the wire returns.
    expect(row.modelId).toBe("ollama/qwen3.5:4b");
    // Token counts come from the replayed body, so usage dashboards stop
    // under-reporting by the whole cache-hit volume.
    expect(row.inputTokens).toBe(23);
    expect(row.outputTokens).toBe(64);
  });

  it("the webhook fires with cacheHit:true", async () => {
    await chat();
    await new Promise((r) => setTimeout(r, 50));
    h.webhooks.length = 0;
    await chat();
    const evt = h.webhooks.find((w) => w.kind === "request_complete");
    expect(evt).toBeTruthy();
    expect(evt.payload.cacheHit).toBe(true);
    expect(evt.payload.provider).toBe("cache");
  });
});

describe("H4 — a cache HIT charges the virtual key", () => {
  it("replays advance the budget counter, so the budget can trip", async () => {
    const raw = mintVirtualKey("zm_live_" + "a".repeat(48), "vk-1");
    const auth = { authorization: `Bearer ${raw}` };

    const miss = await chat(auth);
    expect(miss.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const usageAfterMiss = h.keyUsage.get("vk-1")?.tokens ?? 0;

    const hit = await chat(auth);
    expect(hit.headers.get("x-cache")).toBe("HIT");

    const usageAfterHit = h.keyUsage.get("vk-1")?.tokens ?? 0;
    expect(usageAfterHit).toBe(usageAfterMiss + 87);   // 23 prompt + 64 completion
  });

  it("the ledger row is bucketed under the same 12-char bearer prefix the orchestrator uses", async () => {
    const raw = mintVirtualKey("zm_live_" + "b".repeat(48), "vk-2");
    await chat({ authorization: `Bearer ${raw}` });
    await new Promise((r) => setTimeout(r, 50));
    h.ledger.length = 0;
    await chat({ authorization: `Bearer ${raw}` });
    expect(h.ledger[0].virtualKey).toBe(raw.slice(0, 12));
  });
});

describe("H3 through the route — a HIT is scoped to the caller", () => {
  it("another identity does not get the first caller's stored answer", async () => {
    await chat();                       // anonymous MISS populates the cache
    await new Promise((r) => setTimeout(r, 50));
    expect(h.cache.size).toBe(1);

    const other = await chat({ authorization: "Bearer tenant-B-key-bbbbbbbbbbbb" });
    // Was: `x-cache: HIT`, serving a body generated for a different caller.
    expect(other.headers.get("x-cache")).toBeNull();
  });

  it("the same identity still hits — scoped, not disabled", async () => {
    const auth = { authorization: "Bearer tenant-A-key-aaaaaaaaaaaa" };
    await chat(auth);
    await new Promise((r) => setTimeout(r, 50));
    const again = await chat(auth);
    expect(again.headers.get("x-cache")).toBe("HIT");
  });

  it("the stored key really is the tenant-scoped hash", async () => {
    await chat({ authorization: "Bearer tenant-A-key-aaaaaaaaaaaa" });
    await new Promise((r) => setTimeout(r, 50));
    const expected = computePromptHash(BODY, tenantIdFor({ bearer: "tenant-A-key-aaaaaaaaaaaa" }));
    expect([...h.cache.keys()]).toEqual([expected]);
  });
});
