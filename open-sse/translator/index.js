// OPEN_CORE_STUB — format translators (proprietary, not in community edition)
// The full translator handles OpenAI ↔ Anthropic ↔ Gemini ↔ Groq format conversion.

export function translateRequest(_src, _tgt, _model, body) { return body; }
export function translateResponse(_tgt, _src, chunk) { return chunk; }
export function needsTranslation(_src, _tgt) { return false; }
export function initState(_fmt) { return {}; }
export async function initTranslators() {}
export function register(_name, _translator) {}
