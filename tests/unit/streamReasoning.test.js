/**
 * Unit tests for the SSE passthrough transform: reasoning deltas and the model
 * id on stream chunks.
 *
 * Covers defects 6 and 7 from
 * docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md §5:
 *
 *   6. `hasValuableContent()` accepted `delta.reasoning_content`; Ollama sends
 *      `delta.reasoning`, so every reasoning frame was dropped. Measured on the
 *      live box: raw Ollama emitted 215 `data:` frames for one prompt, ZMLR
 *      emitted 5, and the stream sat silent for the whole thinking phase.
 *   7. Chunks carried `model: "qwen3.5:4b"` (the provider-local tag) rather than
 *      `ollama/qwen3.5:4b`.
 *
 * FIXTURE PROVENANCE: the frames below are verbatim from
 *   curl -N -X POST http://127.0.0.1:11434/v1/chat/completions \
 *     -d '{"model":"qwen3.5:4b","messages":[{"role":"user",
 *          "content":"Reply with exactly one word: PONG"}],
 *          "max_tokens":2000,"temperature":0.7,"stream":true}'
 * against Ollama 0.32.14 on 2026-08-30 (215 data lines: 1 role frame with
 * reasoning, 210 further reasoning-only frames, 2 content frames, 1 finish
 * frame, [DONE]). The middle of the reasoning run is elided; nothing is edited.
 */
import { describe, it, expect } from "vitest";

import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import {
  hasValuableContent,
  normalizeOpenAIChunk,
  applyClientModelToChunk,
} from "../../open-sse/utils/streamHelpers.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

/** Verbatim frames as Ollama wrote them. */
const OLLAMA_FRAMES = [
  '{"id":"chatcmpl-195","object":"chat.completion.chunk","created":1788097604,"model":"qwen3.5:4b","system_fingerprint":"fp_ollama","choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning":"Thinking"},"finish_reason":null}]}',
  '{"id":"chatcmpl-195","object":"chat.completion.chunk","created":1788097604,"model":"qwen3.5:4b","system_fingerprint":"fp_ollama","choices":[{"index":0,"delta":{"content":"","reasoning":" Process"},"finish_reason":null}]}',
  '{"id":"chatcmpl-195","object":"chat.completion.chunk","created":1788097604,"model":"qwen3.5:4b","system_fingerprint":"fp_ollama","choices":[{"index":0,"delta":{"content":"","reasoning":":"},"finish_reason":null}]}',
  '{"id":"chatcmpl-195","object":"chat.completion.chunk","created":1788097604,"model":"qwen3.5:4b","system_fingerprint":"fp_ollama","choices":[{"index":0,"delta":{"content":"","reasoning":"\\n\\n1"},"finish_reason":null}]}',
  '{"id":"chatcmpl-195","object":"chat.completion.chunk","created":1788097604,"model":"qwen3.5:4b","system_fingerprint":"fp_ollama","choices":[{"index":0,"delta":{"content":"","reasoning":" P"},"finish_reason":null}]}',
  '{"id":"chatcmpl-195","object":"chat.completion.chunk","created":1788097604,"model":"qwen3.5:4b","system_fingerprint":"fp_ollama","choices":[{"index":0,"delta":{"content":"","reasoning":"ONG"},"finish_reason":null}]}',
  '{"id":"chatcmpl-195","object":"chat.completion.chunk","created":1788097604,"model":"qwen3.5:4b","system_fingerprint":"fp_ollama","choices":[{"index":0,"delta":{"content":"P"},"finish_reason":null}]}',
  '{"id":"chatcmpl-195","object":"chat.completion.chunk","created":1788097604,"model":"qwen3.5:4b","system_fingerprint":"fp_ollama","choices":[{"index":0,"delta":{"content":"ONG"},"finish_reason":null}]}',
  '{"id":"chatcmpl-195","object":"chat.completion.chunk","created":1788097604,"model":"qwen3.5:4b","system_fingerprint":"fp_ollama","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
];

const REASONING_FRAME_COUNT = 6;   // frames carrying delta.reasoning
const CONTENT_FRAME_COUNT = 2;     // frames carrying non-empty delta.content

function rawSSE(frames) {
  return frames.map((f) => `data: ${f}\n\n`).join("") + "data: [DONE]\n\n";
}

/**
 * Push a raw SSE body through the passthrough transform ZMLR uses for
 * OpenAI-format providers (Ollama, LM Studio) and collect what a client sees.
 */
async function runPassthrough(raw, { clientModel = null, chunkSize = 0 } = {}) {
  const stream = createPassthroughStreamWithLogger(
    "ollama",
    null,
    "qwen3.5:4b",
    null,
    { model: "ollama/qwen3.5:4b", messages: [{ role: "user", content: "Reply with exactly one word: PONG" }] },
    clientModel
  );

  const enc = new TextEncoder();
  const writer = stream.writable.getWriter();
  const pump = (async () => {
    if (chunkSize > 0) {
      for (let i = 0; i < raw.length; i += chunkSize) {
        await writer.write(enc.encode(raw.slice(i, i + chunkSize)));
      }
    } else {
      await writer.write(enc.encode(raw));
    }
    await writer.close();
  })();

  const reader = stream.readable.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  await pump;

  const dataLines = out.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6).trim());
  const chunks = [];
  for (const line of dataLines) {
    if (line === "[DONE]") continue;
    chunks.push(JSON.parse(line));
  }
  return { out, dataLines, chunks };
}

describe("hasValuableContent (OpenAI format)", () => {
  it("REGRESSION (defect 6): keeps a frame whose only payload is delta.reasoning", () => {
    const frame = JSON.parse(OLLAMA_FRAMES[1]);
    expect(hasValuableContent(frame, FORMATS.OPENAI)).toBe(true);
  });

  it("still drops a genuinely empty frame", () => {
    const empty = { choices: [{ index: 0, delta: {}, finish_reason: null }] };
    expect(hasValuableContent(empty, FORMATS.OPENAI)).toBeFalsy();
  });

  it("keeps the finish frame", () => {
    const finish = JSON.parse(OLLAMA_FRAMES[OLLAMA_FRAMES.length - 1]);
    expect(hasValuableContent(finish, FORMATS.OPENAI)).toBeTruthy();
  });
});

describe("normalizeOpenAIChunk", () => {
  it("maps Ollama's `reasoning` onto `reasoning_content`", () => {
    const frame = JSON.parse(OLLAMA_FRAMES[1]);
    expect(normalizeOpenAIChunk(frame)).toBe(true);
    expect(frame.choices[0].delta.reasoning).toBeUndefined();
    expect(frame.choices[0].delta.reasoning_content).toBe(" Process");
    expect(frame.choices[0].delta.content).toBe("");
  });

  it("leaves a chunk that is already correct alone", () => {
    const frame = { choices: [{ index: 0, delta: { reasoning_content: "x" } }] };
    expect(normalizeOpenAIChunk(frame)).toBe(false);
    expect(frame.choices[0].delta.reasoning_content).toBe("x");
  });

  it("appends when both spellings arrive on one delta", () => {
    const frame = { choices: [{ index: 0, delta: { reasoning_content: "a", reasoning: "b" } }] };
    normalizeOpenAIChunk(frame);
    expect(frame.choices[0].delta.reasoning_content).toBe("ab");
    expect(frame.choices[0].delta.reasoning).toBeUndefined();
  });

  it("never touches delta.content", () => {
    const frame = JSON.parse(OLLAMA_FRAMES[6]);
    normalizeOpenAIChunk(frame);
    expect(frame.choices[0].delta.content).toBe("P");
  });

  it("is a no-op on a chunk with no delta", () => {
    expect(normalizeOpenAIChunk({})).toBe(false);
    expect(normalizeOpenAIChunk(null)).toBe(false);
  });
});

describe("applyClientModelToChunk", () => {
  it("rewrites the provider-local tag to the qualified id", () => {
    const frame = JSON.parse(OLLAMA_FRAMES[0]);
    expect(applyClientModelToChunk(frame, "ollama/qwen3.5:4b")).toBe(true);
    expect(frame.model).toBe("ollama/qwen3.5:4b");
  });

  it("does nothing without a client model", () => {
    const frame = JSON.parse(OLLAMA_FRAMES[0]);
    expect(applyClientModelToChunk(frame, null)).toBe(false);
    expect(frame.model).toBe("qwen3.5:4b");
  });
});

describe("passthrough stream over a recorded Ollama reasoning stream", () => {
  it("REGRESSION (defect 6): reasoning deltas reach the client instead of being dropped", async () => {
    const { chunks, dataLines } = await runPassthrough(rawSSE(OLLAMA_FRAMES));

    // Before the fix this was 4 chunks (role + 2 content + finish).
    expect(chunks.length).toBe(OLLAMA_FRAMES.length);
    expect(dataLines[dataLines.length - 1]).toBe("[DONE]");

    const reasoning = chunks.filter((c) => c.choices[0].delta.reasoning_content);
    expect(reasoning.length).toBe(REASONING_FRAME_COUNT);
    expect(reasoning.map((c) => c.choices[0].delta.reasoning_content).join(""))
      .toBe("Thinking Process:\n\n1 PONG");
  });

  it("emits reasoning as reasoning_content, never as the vendor field", async () => {
    const { out, chunks } = await runPassthrough(rawSSE(OLLAMA_FRAMES));
    expect(out).not.toMatch(/"reasoning":/);
    for (const c of chunks) {
      expect(c.choices[0].delta.reasoning).toBeUndefined();
    }
  });

  it("the assistant text is unchanged: concatenating delta.content still yields the answer", async () => {
    const { chunks } = await runPassthrough(rawSSE(OLLAMA_FRAMES));
    const text = chunks.map((c) => c.choices[0].delta.content || "").join("");
    expect(text).toBe("PONG");
    expect(chunks.filter((c) => c.choices[0].delta.content).length).toBe(CONTENT_FRAME_COUNT);
  });

  it("the first content-bearing chunk carries real text (time-to-first-content is never a blank frame)", async () => {
    const { chunks } = await runPassthrough(rawSSE(OLLAMA_FRAMES));
    const firstContent = chunks.find((c) => typeof c.choices[0].delta.content === "string" && c.choices[0].delta.content !== "");
    expect(firstContent).toBeDefined();
    expect(firstContent.choices[0].delta.content.length).toBeGreaterThan(0);
  });

  it("never emits a chunk with an empty delta and no finish_reason", async () => {
    const { chunks } = await runPassthrough(rawSSE(OLLAMA_FRAMES));
    for (const c of chunks) {
      const delta = c.choices[0].delta;
      const empty = Object.keys(delta).length === 0
        || (delta.content === "" && !delta.reasoning_content && !delta.tool_calls && !delta.role);
      if (empty) {
        expect(c.choices[0].finish_reason, `empty delta with no finish_reason: ${JSON.stringify(c)}`).toBeTruthy();
      }
    }
  });

  it("REGRESSION (defect 7): every chunk reports the provider-qualified model id", async () => {
    const { chunks } = await runPassthrough(rawSSE(OLLAMA_FRAMES), { clientModel: "ollama/qwen3.5:4b" });
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.model).toBe("ollama/qwen3.5:4b");
    }
  });

  it("keeps the stream id stable and terminates with exactly one finish_reason", async () => {
    const { chunks } = await runPassthrough(rawSSE(OLLAMA_FRAMES), { clientModel: "ollama/qwen3.5:4b" });
    const ids = new Set(chunks.map((c) => c.id));
    expect(ids.size).toBe(1);
    expect(chunks.filter((c) => c.choices[0].finish_reason).length).toBe(1);
  });

  it("REGRESSION (defect 4): the injected final usage carries no +2000 padding", async () => {
    const { chunks } = await runPassthrough(rawSSE(OLLAMA_FRAMES));
    const last = chunks[chunks.length - 1];
    expect(last.usage).toBeTruthy();
    expect(last.usage.estimated).toBe(true);
    // The whole prompt body is ~120 characters; the old code added 2000.
    expect(last.usage.prompt_tokens).toBeLessThan(200);
    expect(last.usage.total_tokens).toBe(last.usage.prompt_tokens + last.usage.completion_tokens);
  });

  it("survives frames split across network reads", async () => {
    const { chunks } = await runPassthrough(rawSSE(OLLAMA_FRAMES), { clientModel: "ollama/qwen3.5:4b", chunkSize: 37 });
    const text = chunks.map((c) => c.choices[0].delta.content || "").join("");
    expect(text).toBe("PONG");
    expect(chunks.filter((c) => c.choices[0].delta.reasoning_content).length).toBe(REASONING_FRAME_COUNT);
  });
});
