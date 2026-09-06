/**
 * Labs / experimental feature catalog + pure gating helpers.
 *
 * Experimental capabilities (the blockchain / P2P-mesh layer) are PRESERVED in
 * the codebase but hidden by default. Each is independently enable/disable-able
 * per install via settings.experimentalFeatures, surfaced on /dashboard/labs.
 * New versions can add entries here; unknown/missing flags are treated as OFF
 * (fail-closed), so an update never silently turns an experiment on.
 *
 * This module is PURE and dependency-free (no React, no I/O, no Node), so it is
 * safe to import from both the client (Sidebar nav gating, Labs page) and the
 * server (the /api/labs route validates against this same catalog).
 */

/**
 * The single source of truth for experimental features.
 * `navHrefs` lists the dashboard routes each feature reveals in the sidebar.
 */
export const LABS_FEATURES = [
  {
    key: "mesh",
    label: "P2P Mesh Network",
    description:
      "Peer-to-peer node discovery and routing across the ZippyMesh network. Experimental; the mesh layer is still being validated.",
    navHrefs: ["/dashboard/network"],
  },
  {
    key: "marketplace",
    label: "Provider Marketplace",
    description:
      "Decentralized marketplace for discovering and offering hosted model providers. Experimental.",
    navHrefs: ["/dashboard/marketplace"],
  },
  {
    key: "monetization",
    label: "Monetization",
    description:
      "Earn for hosting providers on the mesh (usage settlement). Experimental; depends on the mesh/payment layers.",
    navHrefs: ["/dashboard/monetization"],
  },
  {
    key: "wallet",
    label: "Wallet (ZippyCoin)",
    description:
      "On-device wallet for the ZippyCoin chain used by the mesh economy. Experimental; no real funds.",
    navHrefs: ["/dashboard/wallet"],
  },
  {
    key: "compute",
    label: "Compute Mesh",
    description:
      "Distributed compute sharing across mesh nodes. Experimental.",
    navHrefs: ["/dashboard/compute"],
  },
];

/** Set of all valid feature keys. */
export const LABS_FEATURE_KEYS = LABS_FEATURES.map((f) => f.key);

/** Default flags: every experimental feature OFF. */
export const DEFAULT_LABS_FLAGS = Object.freeze(
  Object.fromEntries(LABS_FEATURE_KEYS.map((k) => [k, false]))
);

/** Map of nav href -> controlling labs key (built once from the catalog). */
const HREF_TO_KEY = (() => {
  const m = new Map();
  for (const f of LABS_FEATURES) {
    for (const href of f.navHrefs) m.set(href, f.key);
  }
  return m;
})();

/**
 * Is a given experimental feature enabled in this flags object?
 * Fail-closed: missing/non-true => false.
 * @param {Record<string, unknown>|null|undefined} flags
 * @param {string} key
 * @returns {boolean}
 */
export function isLabsEnabled(flags, key) {
  if (!flags || typeof flags !== "object") return false;
  return flags[key] === true;
}

/**
 * Which labs feature key (if any) gates a nav href? Returns null for ungated hrefs.
 * @param {string} href
 * @returns {string|null}
 */
export function labsKeyForHref(href) {
  return HREF_TO_KEY.get(href) ?? null;
}

/**
 * Filter a list of nav items, dropping any whose href is labs-gated and whose
 * controlling feature is not enabled. Ungated items always pass through.
 * Never mutates the input.
 * @param {Array<{href?: string}>} items
 * @param {Record<string, unknown>|null|undefined} flags
 * @returns {Array}
 */
export function filterNavByLabs(items, flags) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    const key = item && typeof item.href === "string" ? labsKeyForHref(item.href) : null;
    if (!key) return true; // not an experimental route
    return isLabsEnabled(flags, key);
  });
}

/**
 * Sanitize an arbitrary input object into a clean flags map: only known feature
 * keys are kept, values coerced to strict booleans. Used by the /api/labs route
 * so callers can never inject arbitrary settings keys.
 * @param {unknown} input
 * @returns {Record<string, boolean>}
 */
export function normalizeLabsFlags(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const key of LABS_FEATURE_KEYS) {
    if (key in input) out[key] = input[key] === true;
  }
  return out;
}
