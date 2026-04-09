/**
 * ZippyMesh Plugin Interface — v1
 *
 * All plugins must export a default object matching the shape below.
 * Security note: Plugins run in the same Node.js process. Only install plugins from sources you trust.
 */

export const PLUGIN_INTERFACE_VERSION = 1;

export const PLUGIN_TYPES = {
  PROVIDER: 'provider',
  GUARDRAIL: 'guardrail',
  ROUTING_RULE: 'routing-rule',
};

/**
 * Validate a loaded plugin object against the required interface.
 * Returns { valid: boolean, errors: string[] }
 */
export function validatePlugin(plugin) {
  const errors = [];

  if (!plugin || typeof plugin !== 'object') {
    return { valid: false, errors: ['Plugin must export a default object'] };
  }

  // Required fields for all plugins
  if (!plugin.type || !Object.values(PLUGIN_TYPES).includes(plugin.type)) {
    errors.push(`plugin.type must be one of: ${Object.values(PLUGIN_TYPES).join(', ')}`);
  }
  if (typeof plugin.name !== 'string' || !plugin.name.match(/^[a-z0-9-]+$/)) {
    errors.push('plugin.name must be a lowercase kebab-case string');
  }
  if (typeof plugin.version !== 'string') {
    errors.push('plugin.version must be a semver string (e.g. "1.0.0")');
  }
  if (typeof plugin.init !== 'function') {
    errors.push('plugin.init(config) must be an async function');
  }

  // Type-specific requirements
  if (plugin.type === PLUGIN_TYPES.PROVIDER) {
    if (typeof plugin.listModels !== 'function') errors.push('Provider plugins must implement listModels()');
    if (typeof plugin.chatCompletion !== 'function') errors.push('Provider plugins must implement chatCompletion(body)');
    if (typeof plugin.getHealth !== 'function') errors.push('Provider plugins must implement getHealth()');
  }

  if (plugin.type === PLUGIN_TYPES.GUARDRAIL) {
    if (typeof plugin.checkRequest !== 'function') errors.push('Guardrail plugins must implement checkRequest(messages)');
  }

  if (plugin.type === PLUGIN_TYPES.ROUTING_RULE) {
    if (typeof plugin.scoreCandidate !== 'function') errors.push('Routing-rule plugins must implement scoreCandidate(candidate, context)');
  }

  return { valid: errors.length === 0, errors };
}
