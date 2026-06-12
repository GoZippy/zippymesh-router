/**
 * Session Context Manager for ZippyMesh LLM Router
 * 
 * Tracks session-level routing decisions for consistency.
 * Maintains context across requests from the same client/session.
 */

// In-memory session store (consider Redis/DB for production clustering)
const sessions = new Map();

// Session TTL in milliseconds (default: 30 minutes)
const SESSION_TTL_MS = 30 * 60 * 1000;

// Maximum sessions to track (prevent memory bloat)
const MAX_SESSIONS = 10000;

/**
 * Session context structure
 * @typedef {Object} SessionContext
 * @property {string} sessionId - Unique session identifier
 * @property {string} clientId - Client identifier (device/user)
 * @property {string} lastIntent - Last detected intent
 * @property {string} lastPlaybook - Last used playbook
 * @property {string} lastProvider - Last successful provider
 * @property {string} lastModel - Last successful model
 * @property {number} requestCount - Total requests in session
 * @property {number} codeRequestCount - Code-related requests
 * @property {number} lastActivity - Last activity timestamp
 * @property {Object} providerHistory - Provider success/failure counts
 * @property {Object} intentHistory - Intent frequency counts
 * @property {string[]} failedProviders - Recently failed providers
 * @property {Object} preferences - User-indicated preferences
 */

/**
 * Generate session key from context
 * @param {Object} context - Request context
 * @returns {string} Session key
 */
function getSessionKey(context) {
    // Prefer explicit session ID, fallback to client ID, then fallback to IP
    return context.sessionId 
        || context.clientId 
        || context.headers?.['x-session-id']
        || context.headers?.['x-client-id']
        || context.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
        || context.ip
        || 'anonymous';
}

/**
 * Clean up expired sessions
 */
function cleanupExpiredSessions() {
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, session] of sessions.entries()) {
        if (now - session.lastActivity > SESSION_TTL_MS) {
            expiredKeys.push(key);
        }
    }

    for (const key of expiredKeys) {
        sessions.delete(key);
    }

    // If still over limit, remove oldest
    if (sessions.size > MAX_SESSIONS) {
        const sorted = [...sessions.entries()].sort((a, b) => a[1].lastActivity - b[1].lastActivity);
        const toRemove = sorted.slice(0, sessions.size - MAX_SESSIONS);
        for (const [key] of toRemove) {
            sessions.delete(key);
        }
    }
}

/**
 * Get or create session context
 * @param {Object} context - Request context
 * @returns {SessionContext} Session context
 */
export function getSession(context) {
    const key = getSessionKey(context);
    
    if (sessions.has(key)) {
        const session = sessions.get(key);
        session.lastActivity = Date.now();
        return session;
    }

    // Create new session
    const session = {
        sessionId: key,
        clientId: context.clientId || null,
        lastIntent: null,
        lastPlaybook: null,
        lastProvider: null,
        lastModel: null,
        requestCount: 0,
        codeRequestCount: 0,
        lastActivity: Date.now(),
        createdAt: Date.now(),
        providerHistory: {},
        intentHistory: {},
        failedProviders: [],
        preferences: {
            preferFree: false,
            preferLocal: false,
            preferFast: false,
            avoidProviders: [],
            preferProviders: []
        }
    };

    // Cleanup before adding new
    if (sessions.size >= MAX_SESSIONS) {
        cleanupExpiredSessions();
    }

    sessions.set(key, session);
    return session;
}

/**
 * Update session with routing decision
 * @param {Object} context - Request context
 * @param {Object} decision - Routing decision
 */
export function updateSession(context, decision) {
    const session = getSession(context);

    session.requestCount++;
    session.lastActivity = Date.now();

    if (decision.intent) {
        session.lastIntent = decision.intent;
        session.intentHistory[decision.intent] = (session.intentHistory[decision.intent] || 0) + 1;
        
        if (['code', 'debug', 'review', 'fast_code'].includes(decision.intent)) {
            session.codeRequestCount++;
        }
    }

    if (decision.playbook) {
        session.lastPlaybook = decision.playbook;
    }

    if (decision.provider) {
        session.lastProvider = decision.provider;
    }

    if (decision.model) {
        session.lastModel = decision.model;
    }
}

/**
 * Record provider success
 * @param {Object} context - Request context
 * @param {string} provider - Provider ID
 * @param {string} model - Model ID
 */
export function recordProviderSuccess(context, provider, model) {
    const session = getSession(context);
    
    const key = `${provider}/${model}`;
    if (!session.providerHistory[key]) {
        session.providerHistory[key] = { success: 0, failure: 0, lastSuccess: null };
    }
    
    session.providerHistory[key].success++;
    session.providerHistory[key].lastSuccess = Date.now();
    session.lastProvider = provider;
    session.lastModel = model;

    // Remove from failed list if present
    session.failedProviders = session.failedProviders.filter(p => p !== provider);
}

/**
 * Record provider failure
 * @param {Object} context - Request context
 * @param {string} provider - Provider ID
 * @param {string} model - Model ID
 * @param {string} reason - Failure reason
 */
export function recordProviderFailure(context, provider, model, reason = 'unknown') {
    const session = getSession(context);
    
    const key = `${provider}/${model}`;
    if (!session.providerHistory[key]) {
        session.providerHistory[key] = { success: 0, failure: 0, lastFailure: null };
    }
    
    session.providerHistory[key].failure++;
    session.providerHistory[key].lastFailure = Date.now();
    session.providerHistory[key].lastFailureReason = reason;

    // Add to failed list (keep recent 5)
    if (!session.failedProviders.includes(provider)) {
        session.failedProviders.unshift(provider);
        if (session.failedProviders.length > 5) {
            session.failedProviders.pop();
        }
    }
}

/**
 * Get session-aware routing hints
 * @param {Object} context - Request context
 * @returns {Object} Routing hints
 */
export function getRoutingHints(context) {
    const session = getSession(context);
    const hints = {
        stickyProvider: null,
        stickyModel: null,
        suggestedIntent: null,
        avoidProviders: [...session.failedProviders],
        preferProviders: [],
        isCodeSession: false,
        sessionAge: Date.now() - session.createdAt,
        requestCount: session.requestCount
    };

    // If session has consistent intent, suggest it
    if (session.intentHistory) {
        const sorted = Object.entries(session.intentHistory)
            .sort(([, a], [, b]) => b - a);
        
        if (sorted.length > 0 && sorted[0][1] >= 2) {
            hints.suggestedIntent = sorted[0][0];
        }
    }

    // If code requests dominate, mark as code session
    if (session.codeRequestCount > session.requestCount * 0.5 && session.requestCount >= 2) {
        hints.isCodeSession = true;
    }

    // Suggest sticky provider if it's been working well
    if (session.lastProvider && session.providerHistory) {
        const lastKey = `${session.lastProvider}/${session.lastModel}`;
        const history = session.providerHistory[lastKey];
        
        if (history && history.success >= 2 && history.success > history.failure * 2) {
            hints.stickyProvider = session.lastProvider;
            hints.stickyModel = session.lastModel;
        }
    }

    // Build prefer list from successful providers
    const successfulProviders = Object.entries(session.providerHistory)
        .filter(([, h]) => h.success > h.failure)
        .sort(([, a], [, b]) => b.success - a.success)
        .slice(0, 3)
        .map(([key]) => key.split('/')[0]);
    
    hints.preferProviders = [...new Set(successfulProviders)];

    // Apply user preferences
    if (session.preferences) {
        hints.preferFree = session.preferences.preferFree;
        hints.preferLocal = session.preferences.preferLocal;
        hints.preferFast = session.preferences.preferFast;
        hints.avoidProviders.push(...session.preferences.avoidProviders);
    }

    return hints;
}

/**
 * Set user preference for session
 * @param {Object} context - Request context
 * @param {string} preference - Preference key
 * @param {any} value - Preference value
 */
export function setPreference(context, preference, value) {
    const session = getSession(context);
    
    if (preference in session.preferences) {
        session.preferences[preference] = value;
    }
}

/**
 * Get dominant intent for session
 * @param {Object} context - Request context
 * @returns {string|null} Dominant intent or null
 */
export function getDominantIntent(context) {
    const session = getSession(context);
    
    if (!session.intentHistory || Object.keys(session.intentHistory).length === 0) {
        return null;
    }

    const sorted = Object.entries(session.intentHistory)
        .sort(([, a], [, b]) => b - a);
    
    // Only return if it's clearly dominant (>50% of requests)
    const total = Object.values(session.intentHistory).reduce((a, b) => a + b, 0);
    if (sorted[0][1] > total * 0.5) {
        return sorted[0][0];
    }

    return null;
}

/**
 * Clear session
 * @param {Object} context - Request context
 */
export function clearSession(context) {
    const key = getSessionKey(context);
    sessions.delete(key);
}

/**
 * Get session stats (for monitoring/debugging)
 */
export function getSessionStats() {
    cleanupExpiredSessions();
    
    return {
        activeSessions: sessions.size,
        maxSessions: MAX_SESSIONS,
        ttlMs: SESSION_TTL_MS
    };
}

export default {
    getSession,
    updateSession,
    recordProviderSuccess,
    recordProviderFailure,
    getRoutingHints,
    setPreference,
    getDominantIntent,
    clearSession,
    getSessionStats
};
