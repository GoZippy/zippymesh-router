/**
 * Unit tests for src/lib/routing/meshLimits.js — consumer-side mesh
 * rate-limit filter implementing FEE_MODEL.md "Consumer-side rate limits".
 */
import { describe, it, expect } from "vitest";
import {
    applyMeshLimits,
    normalizeMeshLimits,
    DEFAULT_MESH_LIMITS,
} from "../../src/lib/routing/meshLimits.js";

const route = (overrides = {}) => ({
    provider: "p2p:peerA",
    rate_per_1k_tokens_zat: 1000,
    total_routing_fee_zat: 0,
    operational_trust: 80,
    ...overrides,
});

describe("normalizeMeshLimits", () => {
    it("returns defaults when given null/undefined/non-object", () => {
        expect(normalizeMeshLimits(null)).toEqual(DEFAULT_MESH_LIMITS);
        expect(normalizeMeshLimits(undefined)).toEqual(DEFAULT_MESH_LIMITS);
        expect(normalizeMeshLimits(42)).toEqual(DEFAULT_MESH_LIMITS);
    });

    it("merges partial settings over defaults", () => {
        const merged = normalizeMeshLimits({ preferred_trust_floor: 90 });
        expect(merged.preferred_trust_floor).toBe(90);
        expect(merged.max_rate_per_1k_tokens_zat).toBe(DEFAULT_MESH_LIMITS.max_rate_per_1k_tokens_zat);
        expect(merged.allow_local_fallback).toBe(DEFAULT_MESH_LIMITS.allow_local_fallback);
    });

    it("clamps trust floor to [0,100]", () => {
        expect(normalizeMeshLimits({ preferred_trust_floor: -5 }).preferred_trust_floor).toBe(0);
        expect(normalizeMeshLimits({ preferred_trust_floor: 200 }).preferred_trust_floor).toBe(100);
    });

    it("preserves explicit nulls (no-limit) for ceiling fields", () => {
        const merged = normalizeMeshLimits({
            max_rate_per_1k_tokens_zat: null,
            max_routing_fee_total_zat: null,
        });
        expect(merged.max_rate_per_1k_tokens_zat).toBeNull();
        expect(merged.max_routing_fee_total_zat).toBeNull();
    });

    it("accepts numeric ceilings", () => {
        const merged = normalizeMeshLimits({
            max_rate_per_1k_tokens_zat: 1500,
            max_routing_fee_total_zat: 1_000_000,
        });
        expect(merged.max_rate_per_1k_tokens_zat).toBe(1500);
        expect(merged.max_routing_fee_total_zat).toBe(1_000_000);
    });

    it("rejects negative or non-finite ceiling values (falls back to default)", () => {
        const merged = normalizeMeshLimits({
            max_rate_per_1k_tokens_zat: -1,
            max_routing_fee_total_zat: NaN,
        });
        // both invalid -> fall back to defaults (which are null)
        expect(merged.max_rate_per_1k_tokens_zat).toBe(DEFAULT_MESH_LIMITS.max_rate_per_1k_tokens_zat);
        expect(merged.max_routing_fee_total_zat).toBe(DEFAULT_MESH_LIMITS.max_routing_fee_total_zat);
    });

    it("accepts boolean fallback flag", () => {
        expect(normalizeMeshLimits({ allow_local_fallback: false }).allow_local_fallback).toBe(false);
        expect(normalizeMeshLimits({ allow_local_fallback: true }).allow_local_fallback).toBe(true);
        // non-boolean -> default (true)
        expect(normalizeMeshLimits({ allow_local_fallback: "yes" }).allow_local_fallback).toBe(true);
    });
});

describe("applyMeshLimits", () => {
    it("returns empty result for non-array input", () => {
        const out = applyMeshLimits(null, {});
        expect(out.acceptable).toEqual([]);
        expect(out.rejected).toEqual([]);
        expect(out.limits).toEqual(DEFAULT_MESH_LIMITS);
    });

    it("accepts all routes when no limits configured (defaults: null ceilings, trust floor 60)", () => {
        const routes = [route({ rate_per_1k_tokens_zat: 99999 })];
        const out = applyMeshLimits(routes, {});
        expect(out.acceptable).toHaveLength(1);
        expect(out.rejected).toHaveLength(0);
    });

    it("rejects providers above max_rate_per_1k_tokens_zat", () => {
        const routes = [
            route({ provider: "cheap", rate_per_1k_tokens_zat: 1000 }),
            route({ provider: "expensive", rate_per_1k_tokens_zat: 2000 }),
        ];
        const out = applyMeshLimits(routes, { max_rate_per_1k_tokens_zat: 1500 });
        expect(out.acceptable).toHaveLength(1);
        expect(out.acceptable[0].provider).toBe("cheap");
        expect(out.rejected).toHaveLength(1);
        expect(out.rejected[0].route.provider).toBe("expensive");
        expect(out.rejected[0].reasons[0]).toMatch(/rate 2000/);
    });

    it("treats rate exactly at the limit as acceptable", () => {
        const routes = [route({ rate_per_1k_tokens_zat: 1500 })];
        const out = applyMeshLimits(routes, { max_rate_per_1k_tokens_zat: 1500 });
        expect(out.acceptable).toHaveLength(1);
        expect(out.rejected).toHaveLength(0);
    });

    it("rejects routes whose summed routing fee exceeds max_routing_fee_total_zat", () => {
        const routes = [
            route({ provider: "direct", total_routing_fee_zat: 100 }),
            route({ provider: "long-route", total_routing_fee_zat: 5_000_000 }),
        ];
        const out = applyMeshLimits(routes, { max_routing_fee_total_zat: 1_000_000 });
        expect(out.acceptable.map(r => r.provider)).toEqual(["direct"]);
        expect(out.rejected).toHaveLength(1);
        expect(out.rejected[0].reasons[0]).toMatch(/routing fee 5000000/);
    });

    it("rejects providers below preferred_trust_floor", () => {
        const routes = [
            route({ provider: "trusted", operational_trust: 75 }),
            route({ provider: "shaky", operational_trust: 40 }),
        ];
        const out = applyMeshLimits(routes, { preferred_trust_floor: 70 });
        expect(out.acceptable.map(r => r.provider)).toEqual(["trusted"]);
        expect(out.rejected).toHaveLength(1);
        expect(out.rejected[0].reasons[0]).toMatch(/operational_trust 40/);
    });

    it("aggregates multiple violation reasons on a single rejected route", () => {
        const r = route({
            provider: "bad",
            rate_per_1k_tokens_zat: 5000,
            total_routing_fee_zat: 9_000_000,
            operational_trust: 10,
        });
        const out = applyMeshLimits([r], {
            max_rate_per_1k_tokens_zat: 1500,
            max_routing_fee_total_zat: 1_000_000,
            preferred_trust_floor: 60,
        });
        expect(out.rejected).toHaveLength(1);
        expect(out.rejected[0].reasons).toHaveLength(3);
    });

    it("reports allow_local_fallback in the result for the route picker to consume", () => {
        const out = applyMeshLimits([], { allow_local_fallback: false });
        expect(out.allow_local_fallback).toBe(false);

        const out2 = applyMeshLimits([], { allow_local_fallback: true });
        expect(out2.allow_local_fallback).toBe(true);
    });

    it("treats missing trust as 0 (rejected when floor > 0)", () => {
        const r = { provider: "no-trust-info", rate_per_1k_tokens_zat: 100 };
        const out = applyMeshLimits([r], { preferred_trust_floor: 60 });
        expect(out.acceptable).toHaveLength(0);
        expect(out.rejected).toHaveLength(1);
    });

    it("treats missing routing fee as 0 (always passes the fee check)", () => {
        const r = { provider: "no-fee-info", rate_per_1k_tokens_zat: 100, operational_trust: 80 };
        const out = applyMeshLimits([r], { max_routing_fee_total_zat: 0 });
        expect(out.acceptable).toHaveLength(1);
    });

    it("ignores null/non-object entries in the route list", () => {
        const out = applyMeshLimits([null, undefined, route()], {});
        expect(out.acceptable).toHaveLength(1);
        expect(out.rejected).toHaveLength(0);
    });
});
