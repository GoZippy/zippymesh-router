/**
 * The token ledger records the provider's real token counts.
 *
 * THE BUG (found 2026-08-30, docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md
 * §11 item 1): `handleChatCore` never put a `usage` field on the object it
 * returns. `_executeOrchestratedChat` reads exactly that field —
 *
 *     inputTokens:  result.usage?.prompt_tokens     || ... || 0
 *     outputTokens: result.usage?.completion_tokens || ... || 0
 *
 * — so every row ever written into the SQLite `token_ledger` table carried
 * 0 input / 0 output tokens, for every request, on every install. Nothing on
 * the wire was wrong; the accounting store was empty of numbers.
 *
 * What is asserted here, at the two ends of the seam:
 *
 *  1. `toResultUsage()` / `createUsageWatcher()` in open-sse/handlers/chatCore.js
 *     — the producers. Non-streaming reads the provider's numbers off the
 *     response; streaming reads the final SSE frame's (estimated) usage.
 *  2. `_executeOrchestratedChat` — the consumer. With a stubbed
 *     `handleChatCore` (it is injected as a parameter, so no module mock is
 *     needed) the real orchestrator runs against the real localDb on vitest's
 *     isolated DATA_DIR, and the row is read back out of `token_ledger`.
 *
 * Test 2 deliberately pins the ZERO case: a result with no usage at all still
 * writes a row, with zeros. That is the old behaviour, and keeping it asserted
 * is what makes test 1's numbers mean something.
 *
 * Run ONLY: npx vitest run tests/unit/ledgerUsage.test.js
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

// ─── mocks ───────────────────────────────────────────────────────────────────
// Only two seams are replaced, both because they need infrastructure this test
// has no business standing up:
//   - RoutingEngine, which would otherwise go looking for real provider
//     connections in the DB to build a candidate list;
//   - the provider-lifecycle event bus, which is pure write-side noise here.
// Everything else — queueManager, circuit breaker, model health, pricing,
// usageDb and the whole of localDb including recordTokenUsage — is the real
// module running against the throwaway DATA_DIR that tests/unit/_setup/dataDir.mjs
// installs before any import.

const h = vi.hoisted(() => ({ routes: [] }));

vi.mock("@/lib/routing/engine.js", () => ({
  RoutingEngine: class {
    async findRoute() {
      return h.routes;
    }
    async recordUsage() {
      /* rate-limit bookkeeping is not what this file is about */
    }
  },
}));

vi.mock("@/lib/lifecycleEvents.js", () => ({
  emitProviderLifecycleEvent: async () => {},
}));

let handleOrchestratedChat;
let getSqliteDb;
let updatePricing;
let toResultUsage;
let createUsageWatcher;
let calculateCostFromTokens;

beforeAll(async () => {
  ({ handleOrchestratedChat } = await import("../../src/sse/services/orchestrator.js"));
  ({ getSqliteDb, updatePricing } = await import("../../src/lib/localDb.js"));
  ({ toResultUsage, createUsageWatcher } = await import("../../open-sse/handlers/chatCore.js"));
  ({ calculateCostFromTokens } = await import("../../src/shared/constants/pricing.js"));
});

// ─── helpers ─────────────────────────────────────────────────────────────────

/** One routable candidate for a made-up provider, so ledger rows never collide. */
function useCandidate(provider, model) {
  h.routes = [
    {
      provider,
      model,
      score: 1,
      connection: { id: `conn-${provider}-0000-0000`, provider, isActive: true, metadata: {} },
    },
  ];
}

/** Read the `token_ledger` rows this test wrote for one provider. */
function ledgerRows(provider) {
  const db = getSqliteDb();
  if (!db) return null; // better-sqlite3 unavailable — caller skips
  return db
    .prepare(
      `SELECT provider, model_id AS modelId, input_tokens AS inputTokens,
              output_tokens AS outputTokens, cost_usd AS costUsd, status
         FROM token_ledger WHERE provider = ? ORDER BY id`
    )
    .all(provider);
}

/** Run one orchestrated chat with an injected fake handleChatCore. */
function run(fakeChatCore, { provider, model }) {
  return handleOrchestratedChat({
    body: { model: `${provider}/${model}`, messages: [{ role: "user", content: "hi" }] },
    modelStr: `${provider}/${model}`,
    handleChatCore: fakeChatCore,
    requestId: `req-${provider}`,
  });
}

/** Let a fire-and-forget promise chain settle. */
const flush = () => new Promise((r) => setTimeout(r, 25));

// ─── 1. the producers, in chatCore ───────────────────────────────────────────

describe("chatCore.toResultUsage() — the accounting copy of usage", () => {
  it("carries the provider's OpenAI numbers through unchanged", () => {
    expect(toResultUsage({ prompt_tokens: 11, completion_tokens: 64, total_tokens: 75 })).toEqual({
      prompt_tokens: 11,
      completion_tokens: 64,
      total_tokens: 75,
      estimated: false,
    });
  });

  it("fills in total_tokens when the provider omits it", () => {
    const u = toResultUsage({ prompt_tokens: 11, completion_tokens: 64 });
    expect(u.total_tokens).toBe(75);
  });

  it("reads Claude and Gemini dialects too", () => {
    expect(toResultUsage({ input_tokens: 5, output_tokens: 6 })).toMatchObject({
      prompt_tokens: 5,
      completion_tokens: 6,
      total_tokens: 11,
    });
    expect(toResultUsage({ promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 })).toMatchObject({
      prompt_tokens: 3,
      completion_tokens: 4,
      total_tokens: 7,
    });
  });

  it("flags an estimate as such, and refuses to invent one from nothing", () => {
    expect(toResultUsage({ prompt_tokens: 39, completion_tokens: 1 }, { estimated: true }).estimated).toBe(true);
    expect(toResultUsage(null)).toBeNull();
    expect(toResultUsage(undefined)).toBeNull();
  });
});

describe("chatCore.createUsageWatcher() — the streaming producer", () => {
  it("passes every byte through untouched and settles with the final frame's usage", async () => {
    const frames = [
      'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"PO"}}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"NG"}}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],' +
        '"usage":{"prompt_tokens":39,"completion_tokens":1,"total_tokens":40,"estimated":true}}\n\n',
      "data: [DONE]\n\n",
    ];
    const enc = new TextEncoder();
    const source = new ReadableStream({
      start(controller) {
        for (const f of frames) controller.enqueue(enc.encode(f));
        controller.close();
      },
    });

    const watcher = createUsageWatcher();
    const out = await new Response(source.pipeThrough(watcher.transform)).text();

    // The client's bytes are byte-identical to what the provider sent.
    expect(out).toBe(frames.join(""));

    const usage = await watcher.promise;
    expect(usage).toEqual({
      prompt_tokens: 39,
      completion_tokens: 1,
      total_tokens: 40,
      estimated: true,
    });
  });

  it("survives a frame split across chunk boundaries", async () => {
    const whole =
      'data: {"id":"c2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],' +
      '"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10,"estimated":true}}\n\ndata: [DONE]\n\n';
    const enc = new TextEncoder();
    const cut = 60;
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode(whole.slice(0, cut)));
        controller.enqueue(enc.encode(whole.slice(cut)));
        controller.close();
      },
    });

    const watcher = createUsageWatcher();
    await new Response(source.pipeThrough(watcher.transform)).text();
    expect(await watcher.promise).toMatchObject({ prompt_tokens: 7, completion_tokens: 3 });
  });

  it("settles with null when the stream carried no usage at all", async () => {
    const enc = new TextEncoder();
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const watcher = createUsageWatcher();
    await new Response(source.pipeThrough(watcher.transform)).text();
    expect(await watcher.promise).toBeNull();
  });
});

// ─── 2. the consumer, in the orchestrator ────────────────────────────────────

describe("orchestrator → token_ledger", () => {
  it("writes the provider's real numbers for a non-streaming completion", async () => {
    const provider = "ledgertest";
    const model = "fake-4b";
    useCandidate(provider, model);

    // Exactly the shape handleChatCore now returns: the provider said 11 in /
    // 64 out, and that is what must land in the ledger.
    const fake = vi.fn(async () => ({
      success: true,
      status: 200,
      usage: { prompt_tokens: 11, completion_tokens: 64, total_tokens: 75, estimated: false },
      response: new Response(JSON.stringify({ object: "chat.completion" }), {
        headers: { "Content-Type": "application/json" },
      }),
    }));

    const result = await run(fake, { provider, model });
    expect(fake).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);

    const rows = ledgerRows(provider);
    if (rows === null) return; // no SQLite in this environment
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider,
      modelId: model,
      inputTokens: 11,
      outputTokens: 64,
      status: "success",
    });
  });

  it("REGRESSION: a result with no usage at all still writes a row — of zeros", async () => {
    // This is precisely what the bug looked like from the ledger's side, and it
    // is the shape every ZMLR build before 2026-08-30 produced.
    const provider = "ledgertest-nousage";
    const model = "fake-4b";
    useCandidate(provider, model);

    const fake = vi.fn(async () => ({
      success: true,
      status: 200,
      response: new Response("{}", { headers: { "Content-Type": "application/json" } }),
    }));

    await run(fake, { provider, model });

    const rows = ledgerRows(provider);
    if (rows === null) return;
    expect(rows).toHaveLength(1);
    expect(rows[0].inputTokens).toBe(0);
    expect(rows[0].outputTokens).toBe(0);
  });

  it("writes the streaming estimate once usagePromise settles, and never blocks on it", async () => {
    const provider = "ledgertest-stream";
    const model = "fake-4b";
    useCandidate(provider, model);

    let settle;
    const usagePromise = new Promise((r) => { settle = r; });

    const fake = vi.fn(async () => ({
      success: true,
      status: 200,
      // No synchronous `usage` — a stream cannot have one.
      usagePromise,
      response: new Response("data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } }),
    }));

    await run(fake, { provider, model });

    // The response came back BEFORE the stream drained: no row yet. This is the
    // point of the promise — a client must never wait on the ledger.
    const beforeRows = ledgerRows(provider);
    if (beforeRows === null) return;
    expect(beforeRows).toHaveLength(0);

    settle({ prompt_tokens: 39, completion_tokens: 12, total_tokens: 51, estimated: true });
    await flush();

    const rows = ledgerRows(provider);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inputTokens: 39, outputTokens: 12, status: "success" });
  });

  // ── cost_usd (adversarial review 2026-08-30, item 9a) ──────────────────────
  //
  // THE SECOND BUG in this closure: `ourExpectedCostUsd` was computed ONCE,
  // before the stream, from `result.usage || {}`. A streaming result carries
  // `usagePromise`, not `usage`, so the snapshot priced `{}` and every streamed
  // request booked cost_usd = 0 — which also silently removed it from
  // /api/usage/bill-validation, whose filter is `ourExpectedCostUsd > 0`.
  // writeLedgerRow now recomputes from the usage it was handed.

  const PRICING = { input: 3000, output: 15000 }; // USD per 1M tokens

  it("prices a STREAMED completion from the settled usage, not the empty pre-stream snapshot", async () => {
    const provider = "ledgertest-stream-cost";
    const model = "priced-1";
    useCandidate(provider, model);
    await updatePricing({ [provider]: { [model]: PRICING } });

    let settle;
    const usagePromise = new Promise((r) => { settle = r; });
    const fake = vi.fn(async () => ({
      success: true,
      status: 200,
      usagePromise, // no synchronous `usage` — this is what a stream looks like
      response: new Response("data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } }),
    }));

    await run(fake, { provider, model });
    if (ledgerRows(provider) === null) return; // no SQLite in this environment

    const finalUsage = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, estimated: true };
    settle(finalUsage);
    await flush();

    const rows = ledgerRows(provider);
    expect(rows).toHaveLength(1);

    const expected = calculateCostFromTokens(finalUsage, PRICING); // 1000*3e-3 + 500*15e-3
    expect(expected).toBeGreaterThan(0);
    expect(rows[0].costUsd).toBeCloseTo(expected, 10);
    // REGRESSION: this is exactly the number the old code wrote.
    expect(rows[0].costUsd).not.toBe(0);
  });

  it("a NON-streaming completion is unchanged — same cost, computed the same way", async () => {
    const provider = "ledgertest-nonstream-cost";
    const model = "priced-1";
    useCandidate(provider, model);
    await updatePricing({ [provider]: { [model]: PRICING } });

    const usage = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, estimated: false };
    const fake = vi.fn(async () => ({
      success: true,
      status: 200,
      usage,
      response: new Response("{}", { headers: { "Content-Type": "application/json" } }),
    }));

    await run(fake, { provider, model });
    await flush();

    const rows = ledgerRows(provider);
    if (rows === null) return;
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBeCloseTo(calculateCostFromTokens(usage, PRICING), 10);
  });

  it("an unpriced model still books the row, at zero cost", async () => {
    const provider = "ledgertest-unpriced";
    const model = "no-price";
    useCandidate(provider, model);

    let settle;
    const usagePromise = new Promise((r) => { settle = r; });
    const fake = vi.fn(async () => ({
      success: true, status: 200, usagePromise,
      response: new Response("data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } }),
    }));
    await run(fake, { provider, model });
    if (ledgerRows(provider) === null) return;
    settle({ prompt_tokens: 9, completion_tokens: 9, total_tokens: 18 });
    await flush();

    const rows = ledgerRows(provider);
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBe(0);
    expect(rows[0].inputTokens).toBe(9);
  });

  it("a stream that ends without usage still books the request, at zero", async () => {
    const provider = "ledgertest-stream-empty";
    const model = "fake-4b";
    useCandidate(provider, model);

    const fake = vi.fn(async () => ({
      success: true,
      status: 200,
      usagePromise: Promise.resolve(null),
      response: new Response("data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } }),
    }));

    await run(fake, { provider, model });
    await flush();

    const rows = ledgerRows(provider);
    if (rows === null) return;
    expect(rows).toHaveLength(1);
    expect(rows[0].inputTokens).toBe(0);
  });
});
