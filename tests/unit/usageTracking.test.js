/**
 * Unit tests for the client-facing `usage` object and the model id ZMLR echoes.
 *
 * Covers defects 4 and 7 from
 * docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md:
 *
 *   4. `usage.prompt_tokens` / `total_tokens` were inflated by a fixed +2000
 *      (`BUFFER_TOKENS` in open-sse/utils/usageTracking.js). A two-word prompt
 *      that Ollama measured at 11 tokens was reported as 2011.
 *   7. `response.model` was the provider-local tag (`qwen3.5:4b`) instead of the
 *      id the router resolved (`ollama/qwen3.5:4b`).
 *
 * No network, no DB.
 */
import { describe, it, expect, afterEach } from "vitest";

import {
  addBufferToUsage,
  getUsageBufferTokens,
  formatUsage,
  estimateUsage,
  filterUsageForFormat,
  DEFAULT_USAGE_BUFFER_TOKENS,
} from "../../open-sse/utils/usageTracking.js";
import { resolveClientFacingModelId } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

/** The real numbers Ollama 0.32.14 reported for `{"messages":[{"role":"user","content":"hi"}],"max_tokens":8}`. */
const OLLAMA_USAGE = { prompt_tokens: 11, completion_tokens: 8, total_tokens: 19 };

afterEach(() => {
  delete process.env.ZMLR_USAGE_BUFFER_TOKENS;
});

describe("usage buffer", () => {
  it("is off by default", () => {
    expect(DEFAULT_USAGE_BUFFER_TOKENS).toBe(0);
    expect(getUsageBufferTokens()).toBe(0);
  });

  it("passes the provider's numbers through untouched", () => {
    expect(addBufferToUsage(OLLAMA_USAGE)).toEqual(OLLAMA_USAGE);
  });

  it("does not mutate the object it is given", () => {
    const input = { ...OLLAMA_USAGE };
    addBufferToUsage(input);
    expect(input).toEqual(OLLAMA_USAGE);
  });

  it("fills in total_tokens when the provider omitted it", () => {
    expect(addBufferToUsage({ prompt_tokens: 11, completion_tokens: 8 })).toEqual({
      prompt_tokens: 11,
      completion_tokens: 8,
      total_tokens: 19,
    });
  });

  it("leaves a Claude-shaped usage object alone", () => {
    expect(addBufferToUsage({ input_tokens: 11, output_tokens: 8 })).toEqual({
      input_tokens: 11,
      output_tokens: 8,
    });
  });

  it("restores the old padding only when the operator asks for it", () => {
    process.env.ZMLR_USAGE_BUFFER_TOKENS = "2000";
    expect(getUsageBufferTokens()).toBe(2000);
    expect(addBufferToUsage(OLLAMA_USAGE)).toEqual({
      prompt_tokens: 2011,
      completion_tokens: 8,
      total_tokens: 2019,
    });
    expect(addBufferToUsage({ input_tokens: 11, output_tokens: 8 })).toEqual({
      input_tokens: 2011,
      output_tokens: 8,
    });
  });

  it("ignores a nonsense buffer setting", () => {
    for (const bad of ["", "abc", "-5", "0"]) {
      process.env.ZMLR_USAGE_BUFFER_TOKENS = bad;
      expect(getUsageBufferTokens()).toBe(0);
      expect(addBufferToUsage(OLLAMA_USAGE)).toEqual(OLLAMA_USAGE);
    }
  });

  it("returns non-objects unchanged", () => {
    expect(addBufferToUsage(null)).toBe(null);
    expect(addBufferToUsage(undefined)).toBe(undefined);
    expect(addBufferToUsage(7)).toBe(7);
  });
});

describe("estimated usage", () => {
  it("is unpadded and flagged", () => {
    const usage = formatUsage(10, 4, FORMATS.OPENAI);
    expect(usage).toEqual({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, estimated: true });
  });

  it("keeps the estimated flag through the format filter", () => {
    const usage = estimateUsage({ messages: [{ role: "user", content: "hi" }] }, 40, FORMATS.OPENAI);
    const filtered = filterUsageForFormat(usage, FORMATS.OPENAI);
    expect(filtered.estimated).toBe(true);
    expect(filtered.completion_tokens).toBe(10); // floor(40 / 4)
    expect(filtered.total_tokens).toBe(filtered.prompt_tokens + filtered.completion_tokens);
  });
});

describe("resolveClientFacingModelId", () => {
  const provider = "ollama";
  const model = "qwen3.5:4b";

  it("echoes the provider-qualified id the client sent", () => {
    expect(resolveClientFacingModelId({
      bodyModel: "ollama/qwen3.5:4b",
      clientSentModel: "ollama/qwen3.5:4b",
      provider, model,
    })).toBe("ollama/qwen3.5:4b");
  });

  it("qualifies a bare tag with the provider that served it", () => {
    expect(resolveClientFacingModelId({
      bodyModel: "ollama/qwen3.5:4b",
      clientSentModel: "qwen3.5:4b",
      provider, model,
    })).toBe("ollama/qwen3.5:4b");
  });

  it("resolves `auto` to the model actually used", () => {
    expect(resolveClientFacingModelId({
      bodyModel: "ollama/qwen3.5:4b",
      clientSentModel: "auto",
      provider, model,
    })).toBe("ollama/qwen3.5:4b");
  });

  it("resolves a playbook id to the model actually used", () => {
    expect(resolveClientFacingModelId({
      bodyModel: "ollama/qwen3.5:4b",
      clientSentModel: "zippymesh/code-focus",
      provider, model,
    })).toBe("ollama/qwen3.5:4b");
  });

  it("preserves the client's alias prefix when it names the same model", () => {
    expect(resolveClientFacingModelId({
      bodyModel: "ollama/qwen3.5:4b",
      clientSentModel: "ol/qwen3.5:4b",
      provider, model,
    })).toBe("ol/qwen3.5:4b");
  });

  it("builds provider/model when nothing usable was sent", () => {
    expect(resolveClientFacingModelId({
      bodyModel: undefined, clientSentModel: undefined, provider, model,
    })).toBe("ollama/qwen3.5:4b");
  });

  it("never returns the bare provider-local tag", () => {
    const cases = [
      { bodyModel: "qwen3.5:4b", clientSentModel: "qwen3.5:4b" },
      { bodyModel: null, clientSentModel: null },
      { bodyModel: "/qwen3.5:4b", clientSentModel: "/qwen3.5:4b" },
    ];
    for (const c of cases) {
      expect(resolveClientFacingModelId({ ...c, provider, model })).toBe("ollama/qwen3.5:4b");
    }
  });
});
