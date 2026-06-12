/**
 * Mesh routing consumer-side rate limits filter.
 *
 * Implements the consumer-side rate-limit filter described in
 * `docs/spec/FEE_MODEL.md` (zippycoin-core), section "Consumer-side rate limits".
 *
 * The mesh marketplace (when fully wired) lets users discover providers offering
 * compute, with each provider setting their own price + the routing operators
 * charging per-hop fees. Consumer wallets need a way to refuse routes whose
 * pricing or trust profile falls outside the user's tolerance.
 *
 * Spec fields (all values denominated in ZAT, the smallest ZIP unit):
 *   - max_rate_per_1k_tokens_zat: number | null
 *       Reject providers whose per-1k-token price exceeds this amount.
 *       null = no provider rate ceiling.
 *   - max_routing_fee_total_zat: number | null
 *       Reject routes whose summed hop-routing-fees exceed this amount.
 *       null = no total-routing-fee ceiling.
 *   - preferred_trust_floor: number (0-100)
 *       Reject providers/relays with operational_trust below this.
 *       0 = accept anything; 100 = only top-tier.
 *   - allow_local_fallback: boolean
 *       If true and every mesh route is rejected, the caller may fall back to a
 *       local-only provider (Ollama, LM Studio, etc.). The helper itself does
 *       not perform fallback; the route picker reads this flag from the result
 *       to decide.
 *
 * The function is pure, has no I/O, and is safe to call from anywhere
 * (UI preview, route picker, tests).
 */

/**
 * @typedef {Object} MeshRoute
 * @property {string} [provider]                   Identifier for display/logging.
 * @property {number} rate_per_1k_tokens_zat       Per-1k-token price in ZAT.
 * @property {number} [total_routing_fee_zat]      Sum of hop-routing fees in ZAT (default 0).
 * @property {number} [operational_trust]          Provider/relay trust score 0-100 (default 0).
 */

/**
 * @typedef {Object} MeshLimits
 * @property {number|null}  [max_rate_per_1k_tokens_zat]
 * @property {number|null}  [max_routing_fee_total_zat]
 * @property {number}       [preferred_trust_floor]
 * @property {boolean}      [allow_local_fallback]
 */

/**
 * @typedef {Object} RejectedRoute
 * @property {MeshRoute} route
 * @property {string[]}  reasons   One entry per limit the route violated.
 */

/**
 * Defaults returned when settings are missing or partial.
 */
export const DEFAULT_MESH_LIMITS = Object.freeze({
    max_rate_per_1k_tokens_zat: null,    // no rate ceiling by default
    max_routing_fee_total_zat: null,     // no fee ceiling by default
    preferred_trust_floor: 60,            // matches FEE_MODEL.md ZTI examples
    allow_local_fallback: true,           // graceful degradation by default
});

/**
 * Normalize a partial / arbitrary object into a complete MeshLimits with
 * sane defaults applied. Invalid types fall back to defaults rather than
 * throwing — the helper is intended to be safe in UI/runtime paths.
 *
 * @param {Partial<MeshLimits>|null|undefined} limits
 * @returns {MeshLimits}
 */
export function normalizeMeshLimits(limits) {
    const base = { ...DEFAULT_MESH_LIMITS };
    if (!limits || typeof limits !== "object") return base;

    if (limits.max_rate_per_1k_tokens_zat === null) {
        base.max_rate_per_1k_tokens_zat = null;
    } else if (Number.isFinite(limits.max_rate_per_1k_tokens_zat) && limits.max_rate_per_1k_tokens_zat >= 0) {
        base.max_rate_per_1k_tokens_zat = limits.max_rate_per_1k_tokens_zat;
    }

    if (limits.max_routing_fee_total_zat === null) {
        base.max_routing_fee_total_zat = null;
    } else if (Number.isFinite(limits.max_routing_fee_total_zat) && limits.max_routing_fee_total_zat >= 0) {
        base.max_routing_fee_total_zat = limits.max_routing_fee_total_zat;
    }

    if (Number.isFinite(limits.preferred_trust_floor)) {
        // clamp to [0, 100]
        base.preferred_trust_floor = Math.max(0, Math.min(100, limits.preferred_trust_floor));
    }

    if (typeof limits.allow_local_fallback === "boolean") {
        base.allow_local_fallback = limits.allow_local_fallback;
    }

    return base;
}

/**
 * Apply consumer-side mesh limits to a list of candidate routes.
 *
 * @param {MeshRoute[]} routes              Candidate routes to filter.
 * @param {Partial<MeshLimits>} [limits]    Limits from user settings (any missing
 *                                          fields fall back to DEFAULT_MESH_LIMITS).
 * @returns {{
 *   acceptable: MeshRoute[],
 *   rejected: RejectedRoute[],
 *   limits: MeshLimits,
 *   allow_local_fallback: boolean
 * }}
 */
export function applyMeshLimits(routes, limits) {
    const normalized = normalizeMeshLimits(limits);

    const acceptable = [];
    const rejected = [];

    if (!Array.isArray(routes)) {
        return {
            acceptable,
            rejected,
            limits: normalized,
            allow_local_fallback: normalized.allow_local_fallback,
        };
    }

    for (const route of routes) {
        if (!route || typeof route !== "object") continue;

        const reasons = [];

        const rate = Number(route.rate_per_1k_tokens_zat);
        const totalFee = Number.isFinite(route.total_routing_fee_zat) ? route.total_routing_fee_zat : 0;
        const trust = Number.isFinite(route.operational_trust) ? route.operational_trust : 0;

        if (
            normalized.max_rate_per_1k_tokens_zat !== null &&
            Number.isFinite(rate) &&
            rate > normalized.max_rate_per_1k_tokens_zat
        ) {
            reasons.push(
                `rate ${rate} ZAT/1k > limit ${normalized.max_rate_per_1k_tokens_zat} ZAT/1k`
            );
        }

        if (
            normalized.max_routing_fee_total_zat !== null &&
            Number.isFinite(totalFee) &&
            totalFee > normalized.max_routing_fee_total_zat
        ) {
            reasons.push(
                `routing fee ${totalFee} ZAT > limit ${normalized.max_routing_fee_total_zat} ZAT`
            );
        }

        if (trust < normalized.preferred_trust_floor) {
            reasons.push(
                `operational_trust ${trust} < floor ${normalized.preferred_trust_floor}`
            );
        }

        if (reasons.length === 0) {
            acceptable.push(route);
        } else {
            rejected.push({ route, reasons });
        }
    }

    return {
        acceptable,
        rejected,
        limits: normalized,
        allow_local_fallback: normalized.allow_local_fallback,
    };
}
