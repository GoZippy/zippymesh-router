/**
 * PII Filter — applies active guardrail rules to message content.
 * Runs synchronously before provider call.
 */

/**
 * Apply a list of guardrail rules to a string
 * @param {string} text
 * @param {Array} rules — array of {pattern, replacement, action, isActive}
 * @returns {{ text: string, redactions: string[], blocked: boolean }}
 */
export function applyGuardrails(text, rules) {
  if (!text || !rules?.length) return { text, redactions: [], blocked: false };

  let result = text;
  const redactions = [];
  let blocked = false;

  for (const rule of rules) {
    if (!rule.isActive) continue;
    try {
      const regex = new RegExp(rule.pattern, rule.flags || 'g');
      if (rule.action === 'block') {
        if (regex.test(result)) {
          blocked = true;
          redactions.push(rule.name || rule.id);
        }
      } else {
        const before = result;
        result = result.replace(regex, rule.replacement || '[REDACTED]');
        if (result !== before) {
          redactions.push(rule.replacement || '[REDACTED]');
        }
      }
    } catch (e) {
      // Invalid regex — skip rule
      console.warn(`[PIIFilter] Invalid regex for rule ${rule.id}:`, e.message);
    }
  }

  return { text: result, redactions, blocked };
}

/**
 * Apply guardrails to all messages in a chat completion request body.
 * Returns { body, redactions, blocked }
 */
export function applyGuardrailsToMessages(body, rules) {
  if (!body?.messages || !rules?.length) {
    return { body, redactions: [], blocked: false };
  }

  const allRedactions = [];
  let blocked = false;

  const filteredMessages = body.messages.map(msg => {
    if (typeof msg.content !== 'string') return msg;
    const { text, redactions, blocked: msgBlocked } = applyGuardrails(msg.content, rules);
    allRedactions.push(...redactions);
    if (msgBlocked) blocked = true;
    return { ...msg, content: text };
  });

  return {
    body: { ...body, messages: filteredMessages },
    redactions: [...new Set(allRedactions)],
    blocked,
  };
}
