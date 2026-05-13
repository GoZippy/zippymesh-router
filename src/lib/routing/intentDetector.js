/**
 * Enhanced Intent Detection for ZippyMesh LLM Router
 * 
 * Analyzes request content to determine optimal routing intent.
 * Uses NLP heuristics, keyword analysis, and context signals.
 */

// Intent categories with associated patterns and weights
const INTENT_PATTERNS = {
    // Code-related intents
    code: {
        keywords: [
            'code', 'coding', 'program', 'function', 'class', 'method', 'variable',
            'implement', 'write', 'create', 'build', 'develop', 'script',
            'typescript', 'javascript', 'python', 'rust', 'golang', 'java', 'c++',
            'react', 'vue', 'angular', 'nextjs', 'node', 'express', 'django',
            'api', 'endpoint', 'route', 'component', 'module', 'package',
            'algorithm', 'data structure', 'loop', 'array', 'object', 'string',
            'async', 'await', 'promise', 'callback', 'import', 'export',
            'interface', 'type', 'enum', 'const', 'let', 'var', 'def', 'fn'
        ],
        patterns: [
            /```[\s\S]*?```/,                    // Code blocks
            /\b(function|class|const|let|var|def|fn|impl)\b/i,
            /\b(import|export|require|from)\b/i,
            /\b(async|await|Promise)\b/i,
            /\.(js|ts|py|rs|go|java|cpp|c|rb|php)$/i,
            /\b(npm|pip|cargo|yarn|pnpm)\b/i
        ],
        weight: 1.0,
        playbook: 'zippymesh/code-focus'
    },

    debug: {
        keywords: [
            'debug', 'fix', 'error', 'bug', 'issue', 'problem', 'broken',
            'not working', 'fails', 'crash', 'exception', 'stack trace',
            'undefined', 'null', 'NaN', 'type error', 'syntax error',
            'runtime error', 'compile error', 'build error',
            'troubleshoot', 'diagnose', 'investigate', 'trace', 'log',
            'breakpoint', 'step through', 'inspect', 'watch'
        ],
        patterns: [
            /\b(error|exception|bug|issue|problem)\b/i,
            /\b(fix|debug|troubleshoot|diagnose)\b/i,
            /\b(undefined|null|NaN|TypeError|ReferenceError)\b/i,
            /stack\s*trace/i,
            /\b(why|how come).*(not working|fails|broken)/i
        ],
        weight: 1.2,
        playbook: 'zippymesh/debug'
    },

    architect: {
        keywords: [
            'design', 'architecture', 'system', 'plan', 'structure',
            'database', 'schema', 'model', 'diagram', 'flowchart',
            'microservice', 'monolith', 'serverless', 'cloud',
            'scalable', 'distributed', 'redundant', 'fault-tolerant',
            'pattern', 'strategy', 'approach', 'solution', 'tradeoff',
            'requirements', 'specification', 'roadmap', 'milestone'
        ],
        patterns: [
            /\b(design|architect|plan|structure)\b/i,
            /\b(microservice|monolith|serverless)\b/i,
            /\b(database|schema|model|erd)\b/i,
            /\b(scalab|distribut|fault.?tolerant)\b/i,
            /how should (i|we) (design|architect|structure)/i
        ],
        weight: 1.1,
        playbook: 'zippymesh/architect'
    },

    review: {
        keywords: [
            'review', 'audit', 'check', 'evaluate', 'assess',
            'code review', 'pr review', 'pull request',
            'best practice', 'convention', 'standard', 'guideline',
            'improve', 'optimize', 'refactor', 'clean up',
            'security', 'vulnerability', 'performance'
        ],
        patterns: [
            /\b(review|audit|evaluate|assess)\b/i,
            /\b(improve|optimize|refactor|clean)\b/i,
            /\b(best practice|convention|standard)\b/i,
            /what('s| is) wrong with/i,
            /can you (check|review|look at)/i
        ],
        weight: 1.0,
        playbook: 'zippymesh/review'
    },

    document: {
        keywords: [
            'document', 'summarize', 'summary', 'explain', 'analyze',
            'pdf', 'file', 'article', 'paper', 'report', 'book',
            'extract', 'parse', 'read', 'process', 'understand',
            'long', 'large', 'entire', 'whole', 'full'
        ],
        patterns: [
            /\b(document|summar|analyz|explain)\b/i,
            /\b(pdf|article|paper|report)\b/i,
            /\b(extract|parse|process)\b/i,
            /read (this|the) (document|file|article)/i
        ],
        weight: 0.9,
        playbook: 'zippymesh/document'
    },

    tool_use: {
        keywords: [
            'tool', 'function call', 'api call', 'execute', 'run',
            'agent', 'workflow', 'automation', 'pipeline',
            'mcp', 'plugin', 'extension', 'integration',
            'search', 'browse', 'fetch', 'query'
        ],
        patterns: [
            /\b(tool|function.?call|api.?call)\b/i,
            /\b(agent|workflow|automation)\b/i,
            /\b(execute|run|invoke)\b/i,
            /use (the|a) (tool|function)/i
        ],
        weight: 1.0,
        playbook: 'zippymesh/tool-agent'
    },

    reasoning: {
        keywords: [
            'think', 'reason', 'analyze', 'compare', 'contrast',
            'pros', 'cons', 'tradeoff', 'decision', 'choose',
            'why', 'how', 'explain', 'understand', 'logic',
            'step by step', 'chain of thought', 'reasoning'
        ],
        patterns: [
            /\b(think|reason|analyz|compar)\b/i,
            /\b(pros|cons|tradeoff|decision)\b/i,
            /step.?by.?step/i,
            /chain.?of.?thought/i,
            /\bwhy\b.*\?/i
        ],
        weight: 0.9,
        playbook: 'free/reasoning'
    },

    fast_code: {
        keywords: [
            'quick', 'fast', 'simple', 'basic', 'small',
            'one-liner', 'snippet', 'short', 'tiny', 'minimal'
        ],
        patterns: [
            /\b(quick|fast|simple|basic)\b/i,
            /\b(one.?liner|snippet|short)\b/i,
            /just (need|want) a (quick|simple)/i
        ],
        weight: 0.8,
        playbook: 'zippymesh/Fast-Code'
    },

    ask: {
        keywords: [
            'what', 'who', 'when', 'where', 'which',
            'tell me', 'explain', 'describe', 'define',
            'meaning', 'definition', 'concept', 'idea'
        ],
        patterns: [
            /^(what|who|when|where|which|how)\b/i,
            /\b(tell me|explain|describe|define)\b/i,
            /what (is|are|does|do)/i
        ],
        weight: 0.6,
        playbook: 'zippymesh/ask'
    },

    generic: {
        keywords: [],
        patterns: [],
        weight: 0.1,
        playbook: 'mixed/budget-quality'
    }
};

// Agent/tool hints from user-agent or request headers
const AGENT_HINTS = {
    'cursor': { defaultIntent: 'code', boost: 0.3 },
    'vscode': { defaultIntent: 'code', boost: 0.3 },
    'kilo': { defaultIntent: 'code', boost: 0.3 },
    'openclaw': { defaultIntent: 'code', boost: 0.3 },
    'claude-code': { defaultIntent: 'code', boost: 0.3 },
    'aider': { defaultIntent: 'code', boost: 0.3 },
    'continue': { defaultIntent: 'code', boost: 0.3 },
    'cline': { defaultIntent: 'code', boost: 0.3 },
    'copilot': { defaultIntent: 'code', boost: 0.3 }
};

/**
 * Calculate intent scores for given text
 * @param {string} text - Text to analyze
 * @returns {Object} Scores for each intent
 */
function calculateIntentScores(text) {
    const scores = {};
    const lowerText = text.toLowerCase();

    for (const [intent, config] of Object.entries(INTENT_PATTERNS)) {
        let score = 0;

        // Keyword matching with frequency weighting
        for (const keyword of config.keywords) {
            const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'gi');
            const matches = lowerText.match(regex);
            if (matches) {
                score += matches.length * 0.1;
            }
        }

        // Pattern matching with higher weight
        for (const pattern of config.patterns) {
            if (pattern.test(text)) {
                score += 0.5;
            }
        }

        // Apply intent weight
        scores[intent] = score * config.weight;
    }

    return scores;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract text content from request context
 * @param {Object} context - Request context
 * @returns {string} Combined text for analysis
 */
function extractTextContent(context = {}) {
    const parts = [];

    // System prompt (strong signal)
    if (context.systemPrompt) {
        parts.push(context.systemPrompt);
    }

    // Messages (analyze last few for recency)
    if (Array.isArray(context.messages)) {
        const recentMessages = context.messages.slice(-5);
        for (const msg of recentMessages) {
            if (typeof msg?.content === 'string') {
                parts.push(msg.content);
            } else if (Array.isArray(msg?.content)) {
                for (const part of msg.content) {
                    if (part?.type === 'text' && part?.text) {
                        parts.push(part.text);
                    }
                }
            }
        }
    }

    // Additional context fields
    if (context.prompt) parts.push(context.prompt);
    if (context.message) parts.push(context.message);
    if (context.task) parts.push(context.task);
    if (context.description) parts.push(context.description);

    return parts.join('\n');
}

/**
 * Detect intent from request context
 * @param {Object} context - Request context including messages, system prompt, etc.
 * @returns {Object} Detection result with intent, confidence, playbook, and reasoning
 */
export function detectIntent(context = {}) {
    // Check for explicit intent
    if (context.intent && typeof context.intent === 'string') {
        const explicitIntent = context.intent.trim().toLowerCase();
        const intentConfig = INTENT_PATTERNS[explicitIntent];
        return {
            intent: explicitIntent,
            confidence: 1.0,
            playbook: intentConfig?.playbook || null,
            source: 'explicit',
            reasoning: [`Explicit intent provided: ${explicitIntent}`]
        };
    }

    const reasoning = [];
    const text = extractTextContent(context);

    if (!text || text.trim().length === 0) {
        return {
            intent: 'generic',
            confidence: 0.1,
            playbook: INTENT_PATTERNS.generic.playbook,
            source: 'default',
            reasoning: ['No text content to analyze']
        };
    }

    // Calculate scores for all intents
    const scores = calculateIntentScores(text);

    // Apply agent hints
    const userAgent = (context.userAgent || context.headers?.['user-agent'] || '').toLowerCase();
    for (const [agent, hint] of Object.entries(AGENT_HINTS)) {
        if (userAgent.includes(agent)) {
            scores[hint.defaultIntent] = (scores[hint.defaultIntent] || 0) + hint.boost;
            reasoning.push(`Agent hint from ${agent}: +${hint.boost} to ${hint.defaultIntent}`);
        }
    }

    // Check for code blocks (strong code signal)
    if (/```[\s\S]+```/.test(text)) {
        scores.code = (scores.code || 0) + 0.5;
        reasoning.push('Code blocks detected: +0.5 to code');
    }

    // Check for error/exception indicators (strong debug signal)
    if (/\b(error|exception|stack\s*trace|traceback)\b/i.test(text)) {
        scores.debug = (scores.debug || 0) + 0.4;
        reasoning.push('Error indicators detected: +0.4 to debug');
    }

    // Check for question patterns (ask signal)
    if (/^(what|who|when|where|which|how|why)\b/i.test(text.trim())) {
        scores.ask = (scores.ask || 0) + 0.3;
        reasoning.push('Question pattern detected: +0.3 to ask');
    }

    // Find highest scoring intent
    let maxIntent = 'generic';
    let maxScore = 0;

    for (const [intent, score] of Object.entries(scores)) {
        if (score > maxScore) {
            maxScore = score;
            maxIntent = intent;
        }
    }

    // Calculate confidence (normalize to 0-1)
    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
    const confidence = totalScore > 0 ? Math.min(maxScore / Math.max(totalScore * 0.5, 1), 1.0) : 0.1;

    reasoning.push(`Top scores: ${JSON.stringify(
        Object.entries(scores)
            .filter(([, s]) => s > 0)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([i, s]) => `${i}:${s.toFixed(2)}`)
    )}`);

    return {
        intent: maxIntent,
        confidence: Math.round(confidence * 100) / 100,
        playbook: INTENT_PATTERNS[maxIntent]?.playbook || null,
        source: 'nlp',
        scores,
        reasoning
    };
}

/**
 * Get suggested playbook based on intent detection
 * @param {Object} context - Request context
 * @returns {string|null} Playbook name or null
 */
export function getSuggestedPlaybook(context) {
    const detection = detectIntent(context);
    return detection.playbook;
}

/**
 * Check if request appears to need a code-focused model
 * @param {Object} context - Request context
 * @returns {boolean}
 */
export function isCodeRequest(context) {
    const detection = detectIntent(context);
    return ['code', 'debug', 'review', 'fast_code'].includes(detection.intent);
}

/**
 * Get intent patterns (for UI display or customization)
 */
export function getIntentPatterns() {
    return INTENT_PATTERNS;
}

export default {
    detectIntent,
    getSuggestedPlaybook,
    isCodeRequest,
    getIntentPatterns
};
