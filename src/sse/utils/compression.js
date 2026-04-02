/**
 * Context Compression Service
 * Condenses conversation history to fit within context limits or optimize costs.
 */

/**
 * Summarize chat history
 * @param {Array} messages - Original OpenAI-format messages
 * @param {Object} options - { targetLimit, preserveLastN }
 * @returns {Array} Compressed messages
 */
export function compressContext(messages, { targetLimit = 10, preserveLastN = 4 } = {}) {
    if (!messages || messages.length <= preserveLastN + 1) {
        return messages;
    }

    const systemMessage = messages.find(m => m.role === "system");
    const lastMessages = messages.slice(-preserveLastN);
    const middleMessages = messages.slice(systemMessage ? 1 : 0, -preserveLastN);

    if (middleMessages.length === 0) {
        return messages;
    }

    // Simple heuristic: Take the first message and the last N
    // In a more advanced version, we would use a cheap model to summarize 'middleMessages'
    const summaryPlaceholder = {
        role: "system",
        content: `[Context Compressed: ${middleMessages.length} previous messages summarized for efficiency]`
    };

    const result = [];
    if (systemMessage) result.push(systemMessage);
    result.push(summaryPlaceholder);
    result.push(...lastMessages);

    return result;
}
