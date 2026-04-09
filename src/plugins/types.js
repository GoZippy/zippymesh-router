/**
 * Plugin interface for ZMLR. Build-time plugins (Option A for v0.2.1 alpha).
 * @typedef {Object} PluginNavItem
 * @property {string} label
 * @property {string} path
 * @property {string} icon
 *
 * @typedef {Object} PluginManifest
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {PluginNavItem[]} navItems
 * @property {string} [apiPrefix] - e.g. /api/dvpn
 * @property {'llm'|'dvpn'|'compute'|'enterprise'|'custom'} backend
 */

export const PLUGIN_BACKENDS = Object.freeze({
  LLM: "llm",
  DVPN: "dvpn",
  COMPUTE: "compute",
  ENTERPRISE: "enterprise",
  CUSTOM: "custom",
});
