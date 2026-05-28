/**
 * @file guardrails.js
 * @description Config-file-driven guardrail rule engine for ZippyMesh LLM Router.
 * Supports keyword, regex, and length rules with block/redact/truncate actions.
 * Response sanitization for OpenAI SDK compatibility.
 * Rules are loaded from DATA_DIR/guardrails.config.json or config/guardrails.config.json.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fields that are NOT part of the OpenAI chat completions response spec
// and should be stripped to prevent SDK validation errors (v1.83+)
const NON_STANDARD_RESPONSE_FIELDS = new Set([
  'x_groq',
  'usage_breakdown',
  'service_tier',
  'system_fingerprint',
  'logprobs',
  'model_provider',
  'provider',
  'cached_prompt_tokens',
  'provider_name',
  'native_tokens',
  'metadata',
  'finish_details',
  'citations',
  'grounding_metadata',
  'safety_ratings',
  'prompt_feedback',
  'billing_status',
  'generation_config',
  'index',
  'is_final_chunk',
  'total_tokens',
  'total_tokens_breakdown',
]);

// Fields to strip from choices[].message objects
const NON_STANDARD_MESSAGE_FIELDS = new Set([
  'index',
  'logprobs',
  'finish_reason',
]);

// Fields to preserve in usage (standard OpenAI fields)
const STANDARD_USAGE_FIELDS = new Set([
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'prompt_tokens_details',
  'completion_tokens_details',
]);

// Resolve config path: prefer DATA_DIR, fall back to project config folder
function getConfigPath() {
    if (process.env.DATA_DIR) {
        const dataPath = path.join(process.env.DATA_DIR, 'guardrails.config.json');
        if (fs.existsSync(dataPath)) return dataPath;
    }
    
    const appName = process.env.ZIPPY_APP_NAME || 'zippy-mesh';
    let appDataPath;
    if (process.platform === 'win32') {
        appDataPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
    } else {
        appDataPath = path.join(os.homedir(), `.${appName}`);
    }
    const appDataConfigPath = path.join(appDataPath, 'guardrails.config.json');
    if (fs.existsSync(appDataConfigPath)) return appDataConfigPath;
    
    const projectConfig = path.resolve(__dirname, '../../../config/guardrails.config.json');
    if (fs.existsSync(projectConfig)) return projectConfig;
    
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
        _config = { rules: [], per_route: {} };
        _compiledRules = [];
    }
}

loadConfig();

try {
    fs.watch(CONFIG_PATH, (eventType) => {
        if (eventType === 'change') {
            console.log('[Guardrails] Config changed — reloading rules...');
            loadConfig();
        }
    });
} catch (_) { }

/**
 * Extract all text content from a request body for analysis.
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
 * Get route-specific rule set.
 */
function getRulesForRoute(routePath) {
    const baseRules = [..._compiledRules];
    if (!_config?.per_route) return baseRules;

    const routeConfig = _config.per_route[routePath];
    if (!routeConfig) return baseRules;

    if (routeConfig.inherit === false) {
        return _compiledRules.filter(r => (routeConfig.extra_rules || []).includes(r.id));
    }

    const extraIds = new Set(routeConfig.extra_rules || []);
    const extras = _compiledRules.filter(r => extraIds.has(r.id) && !baseRules.some(b => b.id === r.id));
    return [...baseRules, ...extras];
}

/**
 * Check a request body for safety violations.
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
 * Sanitize a provider response to match the OpenAI Chat Completions API spec.
 * Strips non-standard fields that cause SDK validation errors (v1.83+).
 * 
 * @param {object} response - Raw provider response
 * @param {object} options - Sanitization options
 * @param {string} options.provider - Provider name (for provider-specific rules)
 * @param {boolean} options.stripNonStandard - Strip non-standard fields (default: true)
 * @param {boolean} options.extractReasoning - Extract <think> tags into reasoning_content (default: true)
 * @param {boolean} options.normalizeUsage - Normalize usage to OpenAI format (default: true)
 * @returns {object} Sanitized response
 */
export function sanitizeResponse(response, options = {}) {
    if (!response || typeof response !== 'object') return response;

    const {
        stripNonStandard = true,
        extractReasoning = true,
        normalizeUsage = true,
    } = options;

    let result = response;

    // 1. Strip non-standard top-level fields
    if (stripNonStandard) {
        result = stripNonStandardFields(result);
    }

    // 2. Normalize choices array
    if (result.choices && Array.isArray(result.choices)) {
        result.choices = result.choices.map(choice => {
            const sanitized = { ...choice };

            // Normalize message object
            if (sanitized.message && typeof sanitized.message === 'object') {
                sanitized.message = sanitizeMessageObject(sanitized.message);

                // Extract <think> reasoning from content
                if (extractReasoning && typeof sanitized.message.content === 'string') {
                    const { content, reasoning } = extractThinkTags(sanitized.message.content);
                    sanitized.message.content = content;
                    if (reasoning && !sanitized.message.reasoning_content) {
                        sanitized.message.reasoning_content = reasoning;
                    }
                }
            }

            // Strip non-standard fields from choice
            for (const key of Object.keys(sanitized)) {
                if (NON_STANDARD_MESSAGE_FIELDS.has(key)) continue;
            }

            return sanitized;
        });
    }

    // 3. Normalize usage to OpenAI format
    if (normalizeUsage && result.usage) {
        result.usage = normalizeUsageObject(result.usage);
    }

    // 4. Handle streaming chunk format
    if (result.delta && typeof result.delta === 'object') {
        result.delta = sanitizeMessageObject(result.delta);

        if (extractReasoning && typeof result.delta.content === 'string') {
            const { content, reasoning } = extractThinkTags(result.delta.content);
            result.delta.content = content;
            if (reasoning && !result.delta.reasoning_content) {
                result.delta.reasoning_content = reasoning;
            }
        }
    }

    return result;
}

/**
 * Strip non-standard fields from response object recursively.
 */
function stripNonStandardFields(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    const result = Array.isArray(obj) ? [...obj] : { ...obj };

    for (const key of Object.keys(result)) {
        if (NON_STANDARD_RESPONSE_FIELDS.has(key)) {
            delete result[key];
            continue;
        }

        // Recurse into nested objects (but not choices/messages which get special handling)
        if (key !== 'choices' && key !== 'usage' && typeof result[key] === 'object' && result[key] !== null) {
            result[key] = stripNonStandardFields(result[key]);
        }
    }

    return result;
}

/**
 * Sanitize a message/delta object in the response.
 */
function sanitizeMessageObject(message) {
    if (!message || typeof message !== 'object') return message;

    const result = { ...message };

    // Ensure role is valid
    if (result.role && !['user', 'assistant', 'system', 'tool', 'developer'].includes(result.role)) {
        result.role = 'assistant';
    }

    // Normalize content
    if (result.content === null || result.content === undefined) {
        result.content = '';
    }

    // Sanitize tool_calls
    if (result.tool_calls && Array.isArray(result.tool_calls)) {
        result.tool_calls = result.tool_calls.map(tc => ({
            id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'function',
            function: {
                name: tc.function?.name || '',
                arguments: typeof tc.function?.arguments === 'string'
                    ? tc.function.arguments
                    : JSON.stringify(tc.function?.arguments || {}),
            },
        }));
    }

    // Sanitize tool_call_id
    if (result.tool_call_id && typeof result.tool_call_id !== 'string') {
        result.tool_call_id = String(result.tool_call_id);
    }

    return result;
}

/**
 * Extract <think>...</think> tags from content into reasoning_content.
 * Handles DeepSeek R1 and similar models that embed thinking in content.
 */
function extractThinkTags(content) {
    if (typeof content !== 'string') return { content, reasoning: '' };

    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    const matches = [...content.matchAll(thinkRegex)];

    if (matches.length === 0) {
        return { content, reasoning: '' };
    }

    const reasoningParts = [];
    let cleanContent = content;

    for (const match of matches) {
        reasoningParts.push(match[1].trim());
        cleanContent = cleanContent.replace(match[0], '');
    }

    // Clean up whitespace left behind
    cleanContent = cleanContent.replace(/\n{3,}/g, '\n\n').trim();

    const reasoning = reasoningParts.join('\n\n').trim();

    return { content: cleanContent || '', reasoning };
}

/**
 * Normalize usage object to OpenAI standard format.
 * Handles provider-specific usage field names.
 */
function normalizeUsageObject(usage) {
    if (!usage || typeof usage !== 'object') return usage;

    const normalized = {};

    // Standard token counts
    normalized.prompt_tokens = usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? 0;
    normalized.completion_tokens = usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount ?? usage.completionTokens ?? 0;
    normalized.total_tokens = usage.total_tokens ?? (normalized.prompt_tokens + normalized.completion_tokens);

    // Details
    if (usage.prompt_tokens_details || usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined) {
        normalized.prompt_tokens_details = {
            cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? 0,
            ...(usage.prompt_tokens_details?.audio_tokens !== undefined && { audio_tokens: usage.prompt_tokens_details.audio_tokens }),
        };
    }

    if (usage.completion_tokens_details || usage.reasoning_tokens !== undefined || usage.thoughtsTokenCount !== undefined) {
        normalized.completion_tokens_details = {
            reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens ?? usage.thoughtsTokenCount ?? 0,
            ...(usage.completion_tokens_details?.accepted_prediction_tokens !== undefined && { accepted_prediction_tokens: usage.completion_tokens_details.accepted_prediction_tokens }),
            ...(usage.completion_tokens_details?.rejected_prediction_tokens !== undefined && { rejected_prediction_tokens: usage.completion_tokens_details.rejected_prediction_tokens }),
        };
    }

    return normalized;
}

/**
 * Apply response sanitization pipeline to a provider response.
 * This is the main entry point called by the routing engine.
 */
export function sanitizeProviderResponse(responseBody, provider = 'unknown') {
    return sanitizeResponse(responseBody, {
        provider,
        stripNonStandard: true,
        extractReasoning: true,
        normalizeUsage: true,
    });
}
