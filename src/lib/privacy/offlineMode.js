/**
 * Offline / privacy mode — a single hard switch that disables all NON-provider
 * outbound traffic (telemetry, heartbeat, and any future home-server sync).
 *
 * Default: OFF (but note every phone-home is ALREADY opt-in and off by default;
 * this is a belt-and-suspenders guarantee for privacy-minded users who want one
 * switch that provably blocks everything except the AI providers they configure).
 *
 * Enabled by EITHER:
 *   - env ZIPPY_OFFLINE = true|1|yes|on   (case-insensitive), or
 *   - settings.offlineMode === true
 *
 * Pure + dependency-free so it is safe to import anywhere.
 */

function envTruthy(v) {
  if (typeof v !== "string") return false;
  return ["true", "1", "yes", "on"].includes(v.trim().toLowerCase());
}

/**
 * @param {Record<string, unknown>} [env=process.env]
 * @param {Record<string, unknown>|null} [settings]
 * @returns {boolean}
 */
export function isOfflineMode(env = process.env, settings = null) {
  if (env && envTruthy(env.ZIPPY_OFFLINE)) return true;
  if (settings && typeof settings === "object" && settings.offlineMode === true) return true;
  return false;
}
