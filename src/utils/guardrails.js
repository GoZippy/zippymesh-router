/**
 * @file guardrails.js
 * @description Config-file-driven guardrail rule engine for ZippyMesh LLM Router (Task 2.3.1).
 * Supports keyword, regex, and length rules with block/redact/truncate actions.
 * Rules are loaded from DATA_DIR/guardrails.config.json or config/guardrails.config.json.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve config path: prefer DATA_DIR, fall back to project config folder
function getConfigPath() {
    // Check DATA_DIR first (user data directory)
    if (process.env.DATA_DIR) {
        const dataPath = path.join(process.env.DATA_DIR, 'guardrails.config.json');
        if (fs.existsSync(dataPath)) return dataPath;
    }
    
    // Check platform-specific app data
    const appName = process.env.ZIPPY_APP_NAME || 'zippy-mesh';
    let appDataPath;
    if (process.platform === 'win32') {
        appDataPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
    } else {
        appDataPath = path.join(os.homedir(), `.${appName}`);
    }
    const appDataConfigPath = path.join(appDataPath, 'guardrails.config.json');
    if (fs.existsSync(appDataConfigPath)) return appDataConfigPath;
    
    // Fall back to project-relative config folder
    const projectConfig = path.resolve(__dirname, '../../../config/guardrails.config.json');
    if (fs.existsSync(projectConfig)) return projectConfig;
    
    // Return preferred path for error message (will fail gracefully)
    return appDataConfigPath;
}

const CONFIG_PATH = getConfigPath();

let _config = null;
let _compiledRules = [];

/**
 * Load and compile rules from config file.
 */
function loadConfig() {
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        _config = JSON.parse(raw);
        _compiledRules = _config.rules.map(rule => {
            if (rule.type === 'regex') {
                return { ...rule, _regex: new RegExp(rule.pattern, 'gi') };
            }
            return rule;
        });
        console.log(`[Guardrails] Loaded ${_compiledRules.length} rules from config.`);
    } catch (err) {
        console.error('[Guardrails] Failed to load config, using defaults:', err.message);
        // Fallback minimal config
        _config = { rules: [], per_route: {} };
        _compiledRules = [];
    }
}

// Initial load
loadConfig();

// Hot-reload: watch for config file changes
try {
    fs.watch(CONFIG_PATH, (eventType) => {
        if (eventType === 'change') {
            console.log('[Guardrails] Config changed — reloading rules...');
            loadConfig();
        }
    });
} catch (_) { /* Watch not available in all environments */ }

/**
 * Extract all text content from a request body for analysis.
 * @param {object} body
 * @returns {string}
 */
function extractContent(body) {
    if (!body) return '';
    if (body.messages && Array.isArray(body.messages)) {
        return body.messages
            .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
            .join(' ');
    }
    if (body.prompt) return String(body.prompt);
    return JSON.stringify(body);
}

/**
 * Get route-specific rule set (inherits global rules by default).
 * @param {string} routePath
 * @returns {Array}
 */
function getRulesForRoute(routePath) {
    const baseRules = [..._compiledRules];
    if (!_config?.per_route) return baseRules;

    const routeConfig = _config.per_route[routePath];
    if (!routeConfig) return baseRules;

    if (routeConfig.inherit === false) {
        // Only use extra rules for this route
        return _compiledRules.filter(r => (routeConfig.extra_rules || []).includes(r.id));
    }

    // Merge: inherit all + add extras
    const extraIds = new Set(routeConfig.extra_rules || []);
    const extras = _compiledRules.filter(r => extraIds.has(r.id) && !baseRules.some(b => b.id === r.id));
    return [...baseRules, ...extras];
}

/**
 * Check a request body for safety violations.
 * @param {object} body - Request body
 * @param {string} [routePath='/v1/chat/completions'] - Route for per-route rules
 * @returns {{ safe: boolean, reason?: string, modified?: boolean, body?: object }}
 */
export function checkSafety(body, routePath = '/v1/chat/completions') {
    const rules = getRulesForRoute(routePath);
    let content = extractContent(body);
    let modified = false;

    for (const rule of rules) {
        switch (rule.type) {
            case 'keyword': {
                const lower = content.toLowerCase();
                const hit = rule.terms.find(term => lower.includes(term.toLowerCase()));
                if (hit) {
                    return {
                        safe: false,
                        reason: rule.message || `Blocked content: contains prohibited term "${hit}"`
                    };
                }
                break;
            }

            case 'regex': {
                if (rule.action === 'block' && rule._regex.test(content)) {
                    rule._regex.lastIndex = 0;
                    return { safe: false, reason: rule.message || 'Blocked: regex pattern matched' };
                }
                if (rule.action === 'redact' && rule._regex.test(content)) {
                    rule._regex.lastIndex = 0;
                    // Redact from the body messages
                    if (body?.messages) {
                        body = {
                            ...body,
                            messages: body.messages.map(m => ({
                                ...m,
                                content: typeof m.content === 'string'
                                    ? m.content.replace(rule._regex, rule.replacement || '[REDACTED]')
                                    : m.content
                            }))
                        };
                        content = extractContent(body);
                        modified = true;
                    }
                    rule._regex.lastIndex = 0;
                }
                break;
            }

            case 'length': {
                if (content.length > rule.max_chars) {
                    if (rule.action === 'block') {
                        return { safe: false, reason: rule.message || 'Request too long' };
                    }
                    if (rule.action === 'truncate' && body?.messages?.length > 0) {
                        // Truncate last user message
                        const msgs = [...body.messages];
                        const last = msgs[msgs.length - 1];
                        if (typeof last.content === 'string') {
                            const overage = content.length - rule.max_chars;
                            msgs[msgs.length - 1] = {
                                ...last,
                                content: last.content.slice(0, Math.max(0, last.content.length - overage))
                            };
                            body = { ...body, messages: msgs };
                            modified = true;
                            console.log(`[Guardrails] Truncated request: ${content.length} → ${rule.max_chars} chars`);
                        }
                    }
                }
                break;
            }
        }
    }

    return modified ? { safe: true, modified: true, body } : { safe: true };
}

/**
 * Sanitize a response if necessary.
 * @param {object} response - Response object
 * @returns {object} Sanitized response
 */
export function sanitizeResponse(response) {
    return response;
}
