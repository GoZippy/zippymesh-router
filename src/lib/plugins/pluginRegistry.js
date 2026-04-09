import path from 'path';
import os from 'os';
import fs from 'fs';
import { validatePlugin, PLUGIN_TYPES } from './pluginInterface.js';

const PLUGIN_DIR = path.join(os.homedir(), '.zippy-mesh', 'plugins');

let registeredPlugins = []; // { plugin, name, type, dir }
let initialized = false;

/**
 * Load and register all plugins from ~/.zippy-mesh/plugins/.
 * Called once at startup.
 */
export async function initPlugins() {
  if (initialized) return;
  initialized = true;

  // Ensure plugin dir exists
  try {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
  } catch (e) {
    console.warn('[Plugins] Could not create plugin directory:', e.message);
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(PLUGIN_DIR, { withFileTypes: true });
  } catch (e) {
    console.warn('[Plugins] Could not read plugin directory:', e.message);
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = path.join(PLUGIN_DIR, entry.name);
    const indexPath = path.join(pluginDir, 'index.js');

    if (!fs.existsSync(indexPath)) {
      console.warn(`[Plugins] Skipping ${entry.name}: no index.js found`);
      continue;
    }

    try {
      // Dynamic import — works with ESM plugins
      const mod = await import(indexPath);
      const plugin = mod.default ?? mod;

      const { valid, errors } = validatePlugin(plugin);
      if (!valid) {
        console.warn(`[Plugins] Invalid plugin "${entry.name}":`, errors.join('; '));
        continue;
      }

      // Initialize plugin with empty config (future: load from settings)
      await plugin.init({});

      registeredPlugins.push({ plugin, name: plugin.name, type: plugin.type, dir: pluginDir });
      console.log(`[Plugins] Loaded plugin: ${plugin.name} (${plugin.type} v${plugin.version})`);
    } catch (e) {
      console.warn(`[Plugins] Failed to load plugin "${entry.name}":`, e.message);
    }
  }

  console.log(`[Plugins] ${registeredPlugins.length} plugin(s) loaded from ${PLUGIN_DIR}`);
}

/**
 * Get all registered plugins, optionally filtered by type.
 */
export function getPlugins(type = null) {
  if (type) return registeredPlugins.filter(p => p.type === type).map(p => p.plugin);
  return registeredPlugins.map(p => p.plugin);
}

/**
 * Get a single plugin by name.
 */
export function getPlugin(name) {
  return registeredPlugins.find(p => p.name === name)?.plugin ?? null;
}

/**
 * Get provider plugins as normalized catalog entries (prefix: plugin:[name]/)
 */
export async function getPluginProviderModels() {
  const providers = getPlugins(PLUGIN_TYPES.PROVIDER);
  const allModels = [];
  for (const p of providers) {
    try {
      const models = await p.listModels();
      if (Array.isArray(models)) {
        allModels.push(...models.map(m => ({
          ...m,
          id: `plugin:${p.name}/${m.id || m.name}`,
          provider: `plugin:${p.name}`,
          source: 'plugin',
        })));
      }
    } catch (e) {
      console.warn(`[Plugins] listModels() failed for ${p.name}:`, e.message);
    }
  }
  return allModels;
}

/**
 * Run all guardrail plugins against a messages array.
 * Returns { allowed, messages, reasons }
 */
export async function runGuardrailPlugins(messages) {
  const guardrails = getPlugins(PLUGIN_TYPES.GUARDRAIL);
  let current = messages;
  const reasons = [];

  for (const g of guardrails) {
    try {
      const result = await g.checkRequest(current);
      if (!result.allowed) {
        return { allowed: false, messages: current, reasons: [...reasons, result.reason || g.name] };
      }
      if (result.modified) current = result.modified;
    } catch (e) {
      console.warn(`[Plugins] Guardrail plugin ${g.name} error:`, e.message);
    }
  }

  return { allowed: true, messages: current, reasons };
}

/**
 * Get routing-rule plugin score adjustments for a candidate.
 */
export function getPluginScoreAdjustments(candidate, context) {
  const rules = getPlugins(PLUGIN_TYPES.ROUTING_RULE);
  let total = 0;
  for (const r of rules) {
    try {
      const delta = r.scoreCandidate(candidate, context);
      if (typeof delta === 'number') total += delta;
    } catch (e) {
      console.warn(`[Plugins] Routing-rule plugin ${r.name} error:`, e.message);
    }
  }
  return total;
}

export { PLUGIN_DIR };
