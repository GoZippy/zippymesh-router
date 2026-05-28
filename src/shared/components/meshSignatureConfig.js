/**
 * Pure helpers + display config for the mesh-signature verdict badge (T11).
 *
 * Lives in its own file (no JSX) so vitest — which uses the project's plain
 * vite config without an explicit JSX loader — can import it directly. The
 * React component lives in MeshSignatureBadge.js and re-exports the helpers
 * for callers that want a single import surface.
 */

/**
 * Configuration for each X-Zippy-Signature-Status verdict.
 *
 * The `variant` field maps onto the existing Badge component's tailwind variant
 * palette (success / error / warning) so this badge inherits the app's styling
 * system rather than introducing a new one.
 */
export const MESH_SIGNATURE_STATUS_CONFIG = {
  valid: {
    variant: "success",
    icon: "verified",
    label: "Verified",
    defaultTooltip: "Response signed by mesh peer; integrity verified.",
  },
  invalid: {
    variant: "error",
    icon: "warning",
    label: "TAMPERED",
    defaultTooltip:
      "Signature did not match — response may have been modified in transit. Do not trust this output.",
  },
  missing: {
    variant: "warning",
    icon: "help_outline",
    label: "Unsigned",
    defaultTooltip:
      "No mesh signature present (likely a local provider response, not a peer).",
  },
  error: {
    variant: "warning",
    icon: "error_outline",
    label: "Verify error",
    defaultTooltip: "Verification failed for an unspecified reason.",
  },
};

/**
 * Display priority — when multiple states could apply, render the most
 * security-relevant one first. Used by callers that need to pick a primary
 * verdict to surface (e.g. a stream of partial responses).
 */
export const MESH_SIGNATURE_PRIORITY = [
  "invalid",
  "error",
  "valid",
  "missing",
];

/**
 * Resolve a status string to its display config.
 * Unknown / undefined statuses fall through to the "error" config so the user
 * still sees something rather than silently rendering nothing.
 *
 * @param {string|undefined|null} status
 * @returns {object|null} null only when status is explicitly null/undefined/""
 *   so the caller can render nothing at all (e.g. before a request completes).
 */
export function resolveMeshSignatureConfig(status) {
  if (status === null || status === undefined || status === "") return null;
  return (
    MESH_SIGNATURE_STATUS_CONFIG[status] ?? MESH_SIGNATURE_STATUS_CONFIG.error
  );
}
