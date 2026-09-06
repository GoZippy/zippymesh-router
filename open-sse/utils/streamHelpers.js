import { FORMATS } from "../translator/formats.js";

// Parse SSE data line
export function parseSSELine(line) {
  if (!line || line.charCodeAt(0) !== 100) return null; // 'd' = 100

  const data = line.slice(5).trim();
  if (data === "[DONE]") return { done: true };

  try {
    return JSON.parse(data);
  } catch (error) {
    if (data.length > 0 && data.length < 1000) {
      console.log(`[WARN] Failed to parse SSE line (${data.length} chars): ${data.substring(0, 100)}...`);
    }
    return null;
  }
}

/**
 * Vendor spellings of "thinking tokens" seen on an OpenAI-shaped delta.
 *
 * Ollama (>= 0.32) streams a thinking model's reasoning as `delta.reasoning`.
 * DeepSeek, and every client that grew support for it, use
 * `delta.reasoning_content`. Before 2026-08-30 ZMLR's stream filter only knew
 * `reasoning_content`, so every Ollama reasoning frame failed
 * `hasValuableContent()` and was dropped: raw Ollama emitted 107 `data:` frames
 * for a prompt where ZMLR emitted 5, and the stream sat silent for the whole
 * thinking phase (docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md §5,
 * defect 6).
 */
const REASONING_DELTA_ALIASES = ["reasoning", "reasoning_content", "thinking", "thought"];

/**
 * Normalise an OpenAI-shaped stream chunk in place so every vendor spelling of
 * the reasoning delta arrives at the client as `delta.reasoning_content` — the
 * de-facto OpenAI-compatible field.
 *
 * `delta.content` is left exactly as the provider sent it, so concatenating
 * `delta.content` across the stream still yields the assistant's answer and
 * nothing else.
 *
 * @param {object} chunk - Parsed `chat.completion.chunk`
 * @returns {boolean} true when the chunk was modified (caller must re-serialise)
 */
export function normalizeOpenAIChunk(chunk) {
  const delta = chunk?.choices?.[0]?.delta;
  if (!delta || typeof delta !== "object") return false;

  let mutated = false;
  for (const alias of REASONING_DELTA_ALIASES) {
    if (alias === "reasoning_content") continue;
    const value = delta[alias];
    if (typeof value !== "string" || value === "") {
      // Still drop an empty vendor field so it never reaches the client.
      if (alias in delta && (value === "" || value === null)) {
        delete delta[alias];
        mutated = true;
      }
      continue;
    }
    delta.reasoning_content = (delta.reasoning_content || "") + value;
    delete delta[alias];
    mutated = true;
  }

  return mutated;
}

/**
 * Force an OpenAI-shaped chunk (or non-streaming body) to report the
 * provider-qualified model id the router resolved, rather than the
 * provider-local tag the provider echoes back.
 *
 * @param {object} chunk
 * @param {string|null} clientModelId e.g. "ollama/qwen3.5:4b"
 * @returns {boolean} true when the chunk was modified
 */
export function applyClientModelToChunk(chunk, clientModelId) {
  if (!chunk || typeof chunk !== "object") return false;
  if (typeof clientModelId !== "string" || !clientModelId) return false;
  if (chunk.model === clientModelId) return false;
  if (chunk.model === undefined) return false;
  chunk.model = clientModelId;
  return true;
}

// Check if chunk has valuable content (not empty)
export function hasValuableContent(chunk, format) {
  // OpenAI format
  if (format === FORMATS.OPENAI && chunk.choices?.[0]?.delta) {
    const delta = chunk.choices[0].delta;
    const hasReasoning = REASONING_DELTA_ALIASES.some(
      (alias) => typeof delta[alias] === "string" && delta[alias] !== ""
    );
    return delta.content && delta.content !== "" ||
           hasReasoning ||
           delta.tool_calls && delta.tool_calls.length > 0 ||
           chunk.choices[0].finish_reason ||
           delta.role;
  }

  // Claude format
  if (format === FORMATS.CLAUDE) {
    const isContentBlockDelta = chunk.type === "content_block_delta";
    const hasText = chunk.delta?.text && chunk.delta.text !== "";
    const hasThinking = chunk.delta?.thinking && chunk.delta.thinking !== "";
    const hasInputJson = chunk.delta?.partial_json && chunk.delta.partial_json !== "";
    
    if (isContentBlockDelta && !hasText && !hasThinking && !hasInputJson) {
      return false;
    }
    return true;
  }

  return true; // Other formats: keep all chunks
}

// Fix invalid id (generic or too short)
export function fixInvalidId(parsed) {
  if (parsed.id && (parsed.id === "chat" || parsed.id === "completion" || parsed.id.length < 8)) {
    const fallbackId = parsed.extend_fields?.requestId || 
                      parsed.extend_fields?.traceId || 
                      Date.now().toString(36);
    parsed.id = `chatcmpl-${fallbackId}`;
    return true;
  }
  return false;
}

// Format output as SSE
export function formatSSE(data, sourceFormat) {
  if (data === null || data === undefined) return "data: null\n\n";
  if (data && data.done) return "data: [DONE]\n\n";

  // OpenAI Responses API format
  if (data && data.event && data.data) {
    return `event: ${data.event}\ndata: ${JSON.stringify(data.data)}\n\n`;
  }

  // Claude format
  if (sourceFormat === FORMATS.CLAUDE && data && data.type) {
    if (data.usage && typeof data.usage === 'object' && data.usage.perf_metrics === null) {
      const { perf_metrics, ...usageWithoutPerf } = data.usage;
      data = { ...data, usage: usageWithoutPerf };
    }
    return `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  // Remove null perf_metrics
  if (data?.usage && typeof data.usage === 'object' && data.usage.perf_metrics === null) {
    const { perf_metrics, ...usageWithoutPerf } = data.usage;
    data = { ...data, usage: usageWithoutPerf };
  }

  return `data: ${JSON.stringify(data)}\n\n`;
}
