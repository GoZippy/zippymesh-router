/**
 * src/lib/net/bindHost.js
 *
 * PURE helpers for resolving the network bind host of the ZippyMesh server.
 *
 * Security posture (privacy-first, local-first):
 *   - The DEFAULT bind is "127.0.0.1" (loopback only). This removes the remote
 *     attack surface entirely: nothing on the LAN can reach the node unless the
 *     operator explicitly opts in.
 *   - LAN / all-interfaces exposure ("0.0.0.0") is an EXPLICIT, documented
 *     opt-in via ZIPPY_BIND_HOST=0.0.0.0 (or HOST=0.0.0.0 for Docker).
 *   - When a node is bound to a non-loopback host AND login is disabled
 *     (requireLogin === false, which the app treats as open/superadmin mode),
 *     a remote LAN host can control or reconfigure the node. That combination
 *     is "dangerous exposure" and warrants a loud startup warning.
 *
 * These functions are PURE: no I/O, no environment reads beyond the argument
 * passed in, no top-level side effects. This keeps them trivially testable and
 * safe to import from server entry points.
 */

/** Default bind host — loopback only, secure by default. */
export const DEFAULT_BIND_HOST = "127.0.0.1";

/**
 * Resolve the host the server should bind to.
 *
 * Precedence (most specific wins):
 *   1. env.ZIPPY_BIND_HOST  — the app-specific, explicit knob
 *   2. env.HOST             — generic convention (used by Docker / next start)
 *   3. DEFAULT_BIND_HOST    — "127.0.0.1" (loopback, secure by default)
 *
 * Empty/whitespace-only values are ignored (treated as unset) so an exported
 * but blank variable does not accidentally select an empty host.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {string} the host string to bind to
 */
export function resolveBindHost(env = {}) {
  const e = env || {};
  const pick = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  return pick(e.ZIPPY_BIND_HOST) ?? pick(e.HOST) ?? DEFAULT_BIND_HOST;
}

/**
 * Is the given host a loopback address (reachable only from this machine)?
 *
 * Recognizes the common loopback spellings: "127.0.0.1", "::1", and
 * "localhost". Comparison is case-insensitive and trims surrounding
 * whitespace; IPv6 brackets (e.g. "[::1]") are tolerated.
 *
 * @param {string} host
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  if (typeof host !== "string") return false;
  const h = host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

/**
 * Does this configuration expose the node dangerously?
 *
 * True only when BOTH conditions hold:
 *   - the host is NOT loopback (i.e. reachable from other machines), AND
 *   - requireLogin === false (open mode — the app treats this as superadmin,
 *     and the first-run setup window is unauthenticated).
 *
 * Strict `=== false` is intentional: an unknown/undefined requireLogin (e.g.
 * settings not readily available) is NOT treated as dangerous, so we never
 * emit a false alarm when we simply could not read the setting.
 *
 * @param {string} host
 * @param {boolean} requireLogin
 * @returns {boolean}
 */
export function isDangerousExposure(host, requireLogin) {
  return !isLoopbackHost(host) && requireLogin === false;
}

/**
 * Build a loud, multi-line warning describing the dangerous exposure and how
 * to fix it. Returned as a plain string so the caller decides how to emit it
 * (console.warn, logger, etc.).
 *
 * @param {string} host
 * @returns {string}
 */
export function dangerousExposureWarning(host) {
  const shown = typeof host === "string" && host.trim() !== "" ? host.trim() : "0.0.0.0";
  return [
    "==============================================================",
    "  SECURITY WARNING: ZippyMesh is exposed on the network with",
    "  login DISABLED.",
    "",
    `  Bind host : ${shown}  (reachable from other machines on the LAN)`,
    "  requireLogin : false   (open mode = anyone is treated as superadmin)",
    "",
    "  Any host that can reach this address can control and reconfigure",
    "  this node WITHOUT authentication, including during first-run setup.",
    "",
    "  To fix, do ONE of the following:",
    "    1. Enable login: set requireLogin=true (and set a password via /setup),",
    "       then restart. OR",
    "    2. Bind to loopback only: set ZIPPY_BIND_HOST=127.0.0.1 (the default)",
    "       and use the `dev`/`start` scripts instead of the `:lan` variants.",
    "",
    "  Only expose to the LAN (0.0.0.0) when login is enabled.",
    "==============================================================",
  ].join("\n");
}
