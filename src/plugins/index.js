/**
 * Plugin registry. ENABLED_PLUGINS env (comma-separated) controls which plugins load.
 * Default: llm only.
 * Valid plugin IDs: llm, dvpn, compute
 */

import { manifest as llmManifest } from "./llm/manifest.js";
import { manifest as dvpnManifest } from "./dvpn/manifest.js";
import { manifest as computeManifest } from "./compute/manifest.js";

const allPlugins = {
  llm: llmManifest,
  dvpn: dvpnManifest,
  compute: computeManifest,
};

const VALID_PLUGIN_IDS = Object.keys(allPlugins);

function getEnabledPluginIds() {
  const env = process.env.ENABLED_PLUGINS || "llm";
  const ids = env.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  
  // Validate plugin IDs and warn about unknown ones
  const validIds = [];
  for (const id of ids) {
    if (VALID_PLUGIN_IDS.includes(id)) {
      validIds.push(id);
    } else {
      console.warn(`[Plugin] Unknown plugin ID '${id}'. Valid IDs: ${VALID_PLUGIN_IDS.join(", ")}`);
    }
  }
  
  // Default to 'llm' if no valid plugins specified
  if (validIds.length === 0) {
    console.warn(`[Plugin] No valid plugins enabled, defaulting to 'llm'`);
    return ["llm"];
  }
  
  return validIds;
}

export function getActivePlugins() {
  const ids = getEnabledPluginIds();
  return ids.map((id) => allPlugins[id]).filter(Boolean);
}

export function getNavItems() {
  const plugins = getActivePlugins();
  return plugins.flatMap((p) => p.navItems || []);
}
