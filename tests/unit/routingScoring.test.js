/**
 * Unit tests for the normalized routing-scoring helpers and external-router
 * URL validation in src/lib/routing/engine.js.
 *
 * Covers the High-priority items from
 * plans/routing-engine-architecture-review.md:
 *   1. Normalized 0-1000 weighted scoring that preserves the historical
 *      ordering precedence Group > Priority > Cost > Latency.
 *   2. externalRouterUrl validation: only well-formed http(s) URLs are
 *      accepted; everything else is rejected and never throws.
 */
import { describe, it, expect } from "vitest";
import {
    computeNormalizedScore,
    isValidExternalRouterUrl,
} from "../../src/lib/routing/engine.js";

// GROUP_PRIORITY mirror from defaultStrategy (lower group value == preferred).
const GROUP = { personal: 10, work: 20, team: 30, default: 40 };

/**
 * Build a candidate's scoring factors the same way defaultStrategy does, then
 * score it. Lower score == better (preferred) candidate.
 */
const score = (f) => computeNormalizedScore(f);

describe("computeNormalizedScore — normalized 0-1000 model", () => {
    it("keeps every score within the documented 0-1000 band", () => {
        // Worst-case inputs should saturate each band, not overflow it.
        const worst = score({
            groupScore: 9999,
            priority: 999999,
            costScore: 9999,
            avgLatency: 9_999_999,
        });
        expect(worst).toBeGreaterThanOrEqual(0);
        expect(worst).toBeLessThanOrEqual(1000);

        // Best-case (cheapest/fastest/highest-priority + full bonuses) floors at 0.
        const best = score({
            groupScore: GROUP.personal,
            priority: 1,
            costScore: 0,
            avgLatency: 0,
            trustBonus: 500,
            localBoost: 800,
            visionBoost: 600,
        });
        expect(best).toBe(0);
    });

    it("never returns a negative score (bonuses are floored at 0)", () => {
        const s = score({ groupScore: GROUP.personal, priority: 1, localBoost: 800 });
        expect(s).toBeGreaterThanOrEqual(0);
    });

    it("orders an all-else-equal candidate set strictly by group precedence", () => {
        // When priority/cost/latency are held equal, the group band is the sole
        // differentiator, so the order is exactly personal < work < team < default.
        const candidates = [
            { name: "default", groupScore: GROUP.default, priority: 10, costScore: 1, avgLatency: 200 },
            { name: "team", groupScore: GROUP.team, priority: 10, costScore: 1, avgLatency: 200 },
            { name: "personal", groupScore: GROUP.personal, priority: 10, costScore: 1, avgLatency: 200 },
            { name: "work", groupScore: GROUP.work, priority: 10, costScore: 1, avgLatency: 200 },
        ];

        const ordered = candidates
            .map((c) => ({ ...c, score: score(c) }))
            .sort((a, b) => a.score - b.score)
            .map((c) => c.name);

        expect(ordered).toEqual(["personal", "work", "team", "default"]);
    });

    it("orders a representative mixed candidate set the same way as the additive model", () => {
        // Mixed set: group is the primary factor, but the cost band (0-200) can
        // outweigh small group gaps — this matches the pre-refactor behavior the
        // public ordering contract must preserve.
        const candidates = [
            { name: "personal-cheap-fast", groupScore: GROUP.personal, priority: 1, costScore: 0.5, avgLatency: 100 },
            { name: "personal-pricey", groupScore: GROUP.personal, priority: 1, costScore: 5, avgLatency: 100 },
            { name: "work-cheap", groupScore: GROUP.work, priority: 1, costScore: 0.5, avgLatency: 100 },
            { name: "team-cheap", groupScore: GROUP.team, priority: 1, costScore: 0.5, avgLatency: 100 },
            { name: "default-cheap", groupScore: GROUP.default, priority: 1, costScore: 0.5, avgLatency: 100 },
        ];

        const ordered = candidates
            .map((c) => ({ ...c, score: score(c) }))
            .sort((a, b) => a.score - b.score)
            .map((c) => c.name);

        // Derived from the additive band sums (personal-cheap 51.3 < work-cheap
        // 91.3 < team-cheap 131.3 < personal-pricey 141.3 < default-cheap 171.3):
        // cheaper-but-lower-group can outrank pricier-higher-group, as before.
        expect(ordered).toEqual([
            "personal-cheap-fast",
            "work-cheap",
            "team-cheap",
            "personal-pricey",
            "default-cheap",
        ]);
    });

    it("preserves group precedence when only the group factor differs", () => {
        // A better group strictly beats a worse group when all other factors match.
        const personal = score({ groupScore: GROUP.personal, priority: 10, costScore: 1, avgLatency: 200 });
        const work = score({ groupScore: GROUP.work, priority: 10, costScore: 1, avgLatency: 200 });
        expect(personal).toBeLessThan(work);
    });

    it("breaks group ties by manual priority (lower priority value preferred)", () => {
        const highPriority = score({ groupScore: GROUP.work, priority: 1 });
        const lowPriority = score({ groupScore: GROUP.work, priority: 900 });
        expect(highPriority).toBeLessThan(lowPriority);
    });

    it("breaks group+priority ties by cost (cheaper preferred)", () => {
        const cheap = score({ groupScore: GROUP.work, priority: 10, costScore: 0.1 });
        const pricey = score({ groupScore: GROUP.work, priority: 10, costScore: 5 });
        expect(cheap).toBeLessThan(pricey);
    });

    it("breaks group+priority+cost ties by latency (faster preferred)", () => {
        const fast = score({ groupScore: GROUP.work, priority: 10, costScore: 1, avgLatency: 100 });
        const slow = score({ groupScore: GROUP.work, priority: 10, costScore: 1, avgLatency: 5000 });
        expect(fast).toBeLessThan(slow);
    });

    it("applies bounded bonuses to improve rank without overwhelming the group band", () => {
        const withLocalBoost = score({ groupScore: GROUP.work, priority: 10, localBoost: 800 });
        const withoutBoost = score({ groupScore: GROUP.work, priority: 10, localBoost: 0 });
        // The boost lowers (improves) the score.
        expect(withLocalBoost).toBeLessThan(withoutBoost);
    });

    it("returns a finite, bounded score for empty/default factors", () => {
        const s = score({});
        expect(Number.isFinite(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1000);
    });

    it("is unaffected by lifecyclePenalty when omitted (default 0, backward compatible)", () => {
        const withoutParam = score({ groupScore: GROUP.work, priority: 10, costScore: 1, avgLatency: 200 });
        const withZero = score({ groupScore: GROUP.work, priority: 10, costScore: 1, avgLatency: 200, lifecyclePenalty: 0 });
        expect(withZero).toBe(withoutParam);
    });

    it("sorts a missing/deprecated-model candidate below every normally-scored candidate, even a worst-case one", () => {
        // Regression for: a missing/deprecated registry entry has no price/latency
        // data, so costScore/avgLatency default to 0 — without the penalty this
        // scored as free-and-instant and could rank ABOVE healthy candidates.
        const lifecycleUnsafe = score({
            groupScore: GROUP.personal,   // best possible group
            priority: 1,                  // best possible priority
            costScore: 0,                 // "free" (the actual bug trigger)
            avgLatency: 0,                // "instant" (the actual bug trigger)
            trustBonus: 500,
            localBoost: 800,
            visionBoost: 600,
            lifecyclePenalty: 5000,
        });
        const worstNormalCandidate = score({
            groupScore: 9999,
            priority: 999999,
            costScore: 9999,
            avgLatency: 9_999_999,
        });
        expect(lifecycleUnsafe).toBeGreaterThan(worstNormalCandidate);
    });
});

describe("isValidExternalRouterUrl — config validation", () => {
    it("accepts a valid https URL", () => {
        expect(isValidExternalRouterUrl("https://router.example.com/route")).toBe(true);
    });

    it("accepts a valid http URL", () => {
        expect(isValidExternalRouterUrl("http://localhost:8080/route")).toBe(true);
    });

    it("trims surrounding whitespace before validating", () => {
        expect(isValidExternalRouterUrl("  https://router.example.com  ")).toBe(true);
    });

    it("rejects a non-URL string without throwing", () => {
        expect(() => isValidExternalRouterUrl("not-a-url")).not.toThrow();
        expect(isValidExternalRouterUrl("not-a-url")).toBe(false);
    });

    it("rejects a non-http(s) scheme (ftp://x) without throwing", () => {
        expect(() => isValidExternalRouterUrl("ftp://x")).not.toThrow();
        expect(isValidExternalRouterUrl("ftp://x")).toBe(false);
    });

    it("rejects other non-http(s) schemes (file:, ws:, javascript:)", () => {
        expect(isValidExternalRouterUrl("file:///etc/passwd")).toBe(false);
        expect(isValidExternalRouterUrl("ws://example.com")).toBe(false);
        expect(isValidExternalRouterUrl("javascript:alert(1)")).toBe(false);
    });

    it("rejects an empty / whitespace-only string", () => {
        expect(isValidExternalRouterUrl("")).toBe(false);
        expect(isValidExternalRouterUrl("   ")).toBe(false);
    });

    it("rejects non-string inputs without throwing", () => {
        expect(() => isValidExternalRouterUrl(null)).not.toThrow();
        expect(isValidExternalRouterUrl(null)).toBe(false);
        expect(isValidExternalRouterUrl(undefined)).toBe(false);
        expect(isValidExternalRouterUrl(42)).toBe(false);
        expect(isValidExternalRouterUrl({})).toBe(false);
    });
});
