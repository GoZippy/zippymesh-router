/**
 * Unit tests for the Sprint-2 routing-resilience additions in
 * src/lib/routing/engine.js (Medium-priority items from
 * plans/routing-engine-architecture-review.md):
 *
 *   1. Bounded LRU cache — evicts past its size cap and tracks hit/miss.
 *   2. External-router call — circuit-breaker + timeout protected; on
 *      HTTP error, timeout, open circuit, or thrown error it falls back to
 *      the locally-computed candidate order WITHOUT throwing.
 *   3. getRoutingMetrics() — returns the documented shape.
 *
 * These tests exercise the exported helpers directly (no DB / network), so
 * they stay inside the task's strict edit scope and run fast/deterministically.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    LruCache,
    applyExternalRouterOrder,
    getRoutingMetrics,
    __resetRoutingMetrics,
} from "../../src/lib/routing/engine.js";
import { reset as resetCircuitBreaker, getState as cbGetState } from "../../src/lib/circuitBreaker.js";

const EXTERNAL_ROUTER_CB_KEY = "external-router";

// Two locally-computed candidates in local-preference order. PROVIDER_ID_TO_ALIAS
// maps "openai"->"openai" / "anthropic"->"anthropic" so the external "clientId"
// form is `${provider}/${model}`.
function localResults() {
    return [
        { connection: { id: "c1" }, provider: "openai", model: "gpt-4o", score: 10, reasons: [] },
        { connection: { id: "c2" }, provider: "anthropic", model: "claude-3-5-sonnet", score: 20, reasons: [] },
    ];
}

describe("LruCache — bounded eviction + hit/miss tracking", () => {
    it("evicts the least-recently-used entry once past the cap", () => {
        const cache = new LruCache(2);
        cache.set("a", 1);
        cache.set("b", 2);
        cache.set("c", 3); // exceeds cap of 2 -> "a" (LRU) is evicted

        expect(cache.size).toBe(2);
        expect(cache.has("a")).toBe(false); // evicted
        expect(cache.has("b")).toBe(true);
        expect(cache.has("c")).toBe(true);
        expect(cache.stats().evictions).toBe(1);
    });

    it("promotes recency on read so the read key survives eviction", () => {
        const cache = new LruCache(2);
        cache.set("a", 1);
        cache.set("b", 2);
        // Touch "a" so it becomes most-recently-used; "b" is now the LRU.
        expect(cache.get("a")).toBe(1);
        cache.set("c", 3); // evicts "b", not "a"

        expect(cache.has("a")).toBe(true);
        expect(cache.has("b")).toBe(false);
        expect(cache.has("c")).toBe(true);
    });

    it("tracks hits and misses and computes a hit rate", () => {
        const cache = new LruCache(4);
        cache.set("x", 42);

        expect(cache.get("x")).toBe(42);      // hit
        expect(cache.get("missing")).toBe(undefined); // miss

        const stats = cache.stats();
        expect(stats.hits).toBe(1);
        expect(stats.misses).toBe(1);
        expect(stats.hitRate).toBeCloseTo(0.5, 5);
    });

    it("never grows beyond the cap under churn", () => {
        const cache = new LruCache(3);
        for (let i = 0; i < 50; i++) cache.set(`k${i}`, i);
        expect(cache.size).toBe(3);
        // Only the last 3 inserted keys remain.
        expect(cache.has("k49")).toBe(true);
        expect(cache.has("k47")).toBe(true);
        expect(cache.has("k46")).toBe(false);
    });

    it("coerces an invalid cap to a sane minimum of 1", () => {
        const cache = new LruCache(0);
        expect(cache.maxSize).toBe(1);
        cache.set("a", 1);
        cache.set("b", 2);
        expect(cache.size).toBe(1);
    });
});

describe("applyExternalRouterOrder — circuit breaker + timeout fallback", () => {
    const url = "https://router.example.com/route";
    const payload = { model: "auto", intent: null, hasImage: false, estimatedTokens: 100, clientId: null };

    beforeEach(() => {
        resetCircuitBreaker(EXTERNAL_ROUTER_CB_KEY);
        __resetRoutingMetrics();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("reorders results when the external router returns a valid suggestion", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            json: async () => ({ suggestedModelIds: ["anthropic/claude-3-5-sonnet", "openai/gpt-4o"] }),
        })));

        const results = localResults();
        const ordered = await applyExternalRouterOrder(url, results, payload);

        // anthropic now leads, openai follows — full reorder applied.
        expect(ordered.map((r) => r.provider)).toEqual(["anthropic", "openai"]);
        expect(getRoutingMetrics().externalRouter.successes).toBe(1);
        // Success should leave the breaker closed.
        expect(cbGetState(EXTERNAL_ROUTER_CB_KEY).state).toBe("closed");
    });

    it("falls back to local order (no throw) when fetch rejects", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));

        const results = localResults();
        let ordered;
        await expect((async () => { ordered = await applyExternalRouterOrder(url, results, payload); })()).resolves.toBeUndefined();

        // Order is exactly the local order — unchanged.
        expect(ordered.map((r) => r.provider)).toEqual(["openai", "anthropic"]);
        expect(getRoutingMetrics().externalRouter.failures).toBe(1);
    });

    it("classifies an aborted/timeout error as a timeout and falls back", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            throw err;
        }));

        const results = localResults();
        const ordered = await applyExternalRouterOrder(url, results, payload);

        expect(ordered.map((r) => r.provider)).toEqual(["openai", "anthropic"]);
        expect(getRoutingMetrics().externalRouter.timeouts).toBe(1);
    });

    it("falls back on a non-OK HTTP status and trips the breaker", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));

        const results = localResults();
        const ordered = await applyExternalRouterOrder(url, results, payload);

        expect(ordered.map((r) => r.provider)).toEqual(["openai", "anthropic"]);
        expect(getRoutingMetrics().externalRouter.failures).toBe(1);
    });

    it("opens the circuit after repeated failures, then skips the call (open-circuit fallback)", async () => {
        const fetchMock = vi.fn(async () => { throw new Error("down"); });
        vi.stubGlobal("fetch", fetchMock);

        // Default breaker threshold is 5 failures -> trips to "open".
        for (let i = 0; i < 5; i++) {
            await applyExternalRouterOrder(url, localResults(), payload);
        }
        expect(cbGetState(EXTERNAL_ROUTER_CB_KEY).state).toBe("open");

        const callsBefore = fetchMock.mock.calls.length;
        // Next call must NOT hit fetch — it short-circuits to the local order.
        const ordered = await applyExternalRouterOrder(url, localResults(), payload);
        expect(fetchMock.mock.calls.length).toBe(callsBefore); // no new fetch
        expect(ordered.map((r) => r.provider)).toEqual(["openai", "anthropic"]);
        expect(getRoutingMetrics().externalRouter.openCircuitSkips).toBeGreaterThanOrEqual(1);
    });

    it("returns the input unchanged for empty results without calling fetch", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const out = await applyExternalRouterOrder(url, [], payload);
        expect(out).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("getRoutingMetrics — shape contract", () => {
    beforeEach(() => {
        __resetRoutingMetrics();
    });

    it("returns the documented top-level shape", () => {
        const m = getRoutingMetrics();
        expect(m).toHaveProperty("routes");
        expect(m).toHaveProperty("externalRouter");
        expect(m).toHaveProperty("registryCache");
        expect(m).toHaveProperty("stageTimingsMs");

        expect(typeof m.routes).toBe("number");
        for (const k of ["attempts", "successes", "failures", "timeouts", "openCircuitSkips", "invalidUrlSkips"]) {
            expect(m.externalRouter).toHaveProperty(k);
            expect(typeof m.externalRouter[k]).toBe("number");
        }
        for (const k of ["size", "maxSize", "hits", "misses", "evictions", "hitRate"]) {
            expect(m.registryCache).toHaveProperty(k);
            expect(typeof m.registryCache[k]).toBe("number");
        }
        expect(typeof m.stageTimingsMs).toBe("object");
    });

    it("reflects external-router activity after a successful call", async () => {
        resetCircuitBreaker(EXTERNAL_ROUTER_CB_KEY);
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ suggestedModelIds: [] }) })));

        await applyExternalRouterOrder(
            "https://router.example.com",
            localResults(),
            { model: "auto" }
        );

        const m = getRoutingMetrics();
        expect(m.externalRouter.attempts).toBe(1);
        expect(m.externalRouter.successes).toBe(1);
        vi.restoreAllMocks();
    });

    it("is read-only — mutating the returned snapshot does not affect internal state", () => {
        const m = getRoutingMetrics();
        m.routes = 999;
        m.externalRouter.attempts = 999;
        expect(getRoutingMetrics().routes).toBe(0);
        expect(getRoutingMetrics().externalRouter.attempts).toBe(0);
    });
});
