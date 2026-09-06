/**
 * Unit tests for the prompt-cache key and cache-hit identity.
 *
 * Covers defect 5 from docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md §8:
 * `computePromptHash` hashed only `{model, messages, temperature, max_tokens}`,
 * so a `response_format: {type:"json_object"}` request collided with the plain
 * request that preceded it and was answered from cache with the plain prose
 * answer — same `id`, `x-cache: HIT`. Verified live against Ollama before the
 * fix.
 *
 * No network. `@/lib/localDb.js` is imported transitively; tests/unit/_setup
 * has already pointed DATA_DIR at a throwaway directory.
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";

import {
  computePromptHash,
  isCacheable,
  mintCachedResponseId,
  refreshCachedResponseIdentity,
} from "../../src/lib/promptCache.js";

const BASE = {
  model: "ollama/qwen3.5:4b",
  messages: [{ role: "user", content: "reply with the number 7" }],
  max_tokens: 64,
  temperature: 0,
};

describe("computePromptHash", () => {
  it("is stable for an identical body", () => {
    expect(computePromptHash({ ...BASE })).toBe(computePromptHash({ ...BASE }));
  });

  it("ignores key order in the body and in nested objects", () => {
    const reordered = {
      temperature: 0,
      max_tokens: 64,
      messages: [{ content: "reply with the number 7", role: "user" }],
      model: "ollama/qwen3.5:4b",
    };
    expect(computePromptHash(reordered)).toBe(computePromptHash(BASE));
  });

  it("REGRESSION (defect 5): response_format changes the key", () => {
    const jsonMode = { ...BASE, response_format: { type: "json_object" } };
    expect(computePromptHash(jsonMode)).not.toBe(computePromptHash(BASE));
  });

  it("distinguishes two different response_format values", () => {
    const a = computePromptHash({ ...BASE, response_format: { type: "json_object" } });
    const b = computePromptHash({ ...BASE, response_format: { type: "text" } });
    expect(a).not.toBe(b);
  });

  it.each([
    ["model", { model: "ollama/gemma3:1B" }],
    ["messages", { messages: [{ role: "user", content: "something else" }] }],
    ["temperature", { temperature: 0.7 }],
    ["max_tokens", { max_tokens: 65 }],
    ["top_p", { top_p: 0.5 }],
    ["stop", { stop: ["\n"] }],
    ["seed", { seed: 42 }],
    ["n", { n: 2 }],
    ["tool_choice", { tool_choice: "auto" }],
    ["tools", { tools: [{ type: "function", function: { name: "get_weather" } }] }],
    ["max_completion_tokens", { max_completion_tokens: 128 }],
    ["logit_bias", { logit_bias: { 42: -100 } }],
    ["reasoning_effort", { reasoning_effort: "high" }],
  ])("changing %s changes the key", (_field, patch) => {
    expect(computePromptHash({ ...BASE, ...patch })).not.toBe(computePromptHash(BASE));
  });

  it.each([
    ["stream", { stream: false }],
    ["stream_options", { stream_options: { include_usage: true } }],
    ["user", { user: "alice" }],
    ["metadata", { metadata: { trace: "abc" } }],
    ["_routing", { _routing: { selected: "ollama/qwen3.5:4b" } }],
  ])("%s does not change the key", (_field, patch) => {
    expect(computePromptHash({ ...BASE, ...patch })).toBe(computePromptHash(BASE));
  });

  it("an explicitly undefined field is the same as an absent one", () => {
    expect(computePromptHash({ ...BASE, seed: undefined })).toBe(computePromptHash(BASE));
  });

  it("a v1 key can never be served against a v2 key", () => {
    // The old allow-list key, reproduced exactly as it was before the fix.
    const legacy = JSON.stringify({
      model: BASE.model,
      messages: BASE.messages,
      temperature: BASE.temperature,
      max_tokens: BASE.max_tokens,
    });
    const legacyHash = crypto.createHash("sha256").update(legacy).digest("hex");
    expect(computePromptHash(BASE)).not.toBe(legacyHash);
  });
});

describe("isCacheable", () => {
  it("accepts a deterministic non-streaming request", () => {
    expect(isCacheable(BASE)).toBe(true);
    expect(isCacheable({ ...BASE, temperature: undefined })).toBe(true);
  });

  it("refuses streaming requests", () => {
    expect(isCacheable({ ...BASE, stream: true })).toBe(false);
  });

  it("refuses a non-zero temperature", () => {
    expect(isCacheable({ ...BASE, temperature: 0.7 })).toBe(false);
  });

  it("refuses a request carrying tools, deterministic or not", () => {
    const withTools = { ...BASE, tools: [{ type: "function", function: { name: "get_weather" } }] };
    expect(isCacheable(withTools)).toBe(false);
    expect(isCacheable({ ...withTools, temperature: 0, seed: 1 })).toBe(false);
  });

  it("refuses n > 1", () => {
    expect(isCacheable({ ...BASE, n: 2 })).toBe(false);
    expect(isCacheable({ ...BASE, n: 1 })).toBe(true);
  });

  it("refuses a non-object body", () => {
    expect(isCacheable(null)).toBe(false);
    expect(isCacheable("nope")).toBe(false);
  });
});

describe("cache-hit identity", () => {
  it("mints a distinct OpenAI-shaped completion id every time", () => {
    const a = mintCachedResponseId();
    const b = mintCachedResponseId();
    expect(a).toMatch(/^chatcmpl-[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
  });

  it("REGRESSION (defect 5): a replayed response gets a fresh id and created", () => {
    const stored = {
      id: "chatcmpl-853",
      object: "chat.completion",
      created: 1788095744,
      model: "ollama/qwen3.5:4b",
      choices: [{ index: 0, message: { role: "assistant", content: "7" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 1, total_tokens: 12 },
    };
    const replayed = refreshCachedResponseIdentity({ ...stored });
    expect(replayed.id).not.toBe(stored.id);
    expect(replayed.id).toMatch(/^chatcmpl-/);
    expect(replayed.created).toBeGreaterThan(stored.created);
    // Everything a client reads as content is untouched.
    expect(replayed.choices).toEqual(stored.choices);
    expect(replayed.usage).toEqual(stored.usage);
    expect(replayed.model).toBe(stored.model);
  });

  it("tolerates a body with no id", () => {
    const out = refreshCachedResponseIdentity({ object: "chat.completion" });
    expect(out.id).toMatch(/^chatcmpl-/);
  });

  it("returns non-objects unchanged", () => {
    expect(refreshCachedResponseIdentity(null)).toBe(null);
  });
});
