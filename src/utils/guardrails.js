/**
 * Guardrails utility for ZippyMesh LLM Router.
 * Provides basic content filtering and safety checks.
 */

const BLOCKED_KEYWORDS = [
    "poison", "explosive", "illegal", "hack", "bypass" // Example list
];

/**
 * Checks a request body for safety violations.
 * @param {object} body - Request body
 * @returns {object} { safe: boolean, reason?: string }
 */
export function checkSafety(body) {
    if (!body || !body.messages) return { safe: true };

    const content = body.messages.map(m => m.content).join(" ").toLowerCase();

    for (const word of BLOCKED_KEYWORDS) {
        if (content.includes(word)) {
            return {
                safe: false,
                reason: `Blocked content detected: contains prohibited term "${word}"`
            };
        }
    }

    // Basic PII detection (Regex for email and potential keys)
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    if (emailRegex.test(content)) {
        return {
            safe: false,
            reason: "Safety violation: Potentially contains PII (email address)"
        };
    }

    return { safe: true };
}

/**
 * Sanitizes a response if necessary.
 * @param {object} response - Response object
 * @returns {object} Sanitized response
 */
export function sanitizeResponse(response) {
    // Implement response filtering here if needed
    return response;
}
