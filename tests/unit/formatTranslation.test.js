/**
 * Unit tests for format translation utilities in open-sse/translator/
 *
 * Tests:
 *   - openaiToGeminiRequest()   (open-sse/translator/request/openai-to-gemini.js)
 *   - openaiToClaudeRequest()   (open-sse/translator/request/openai-to-claude.js)
 *   - claudeToOpenAIResponse()  (open-sse/translator/response/claude-to-openai.js)
 *   - geminiToOpenAIResponse()  (open-sse/translator/response/gemini-to-openai.js)
 *
 * No network calls, no DB, no environment variables required.
 * The translator files call register() as a side-effect — that is fine; the
 * registry module is a plain in-memory map and has no external dependencies.
 */
import { describe, it, expect } from "vitest";

// Request translators
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

// Response translators
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { geminiToOpenAIResponse } from "../../open-sse/translator/response/gemini-to-openai.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal OpenAI messages body */
function openaiBody(overrides = {}) {
  return {
    messages: [
      { role: "user", content: "Hello, world!" },
    ],
    ...overrides,
  };
}

/** Fresh state object required by streaming response translators */
function freshState(overrides = {}) {
  return {
    messageId: null,
    model: null,
    toolCalls: new Map(),
    toolCallIndex: 0,
    functionIndex: 0,
    finishReason: null,
    finishReasonSent: false,
    usage: null,
    inThinkingBlock: false,
    textBlockStarted: false,
    toolNameMap: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// openaiToGeminiRequest — OpenAI → Gemini
// ---------------------------------------------------------------------------

describe("openaiToGeminiRequest()", () => {
  it("converts a simple user message to Gemini contents format", () => {
    const result = openaiToGeminiRequest("gemini-pro", openaiBody(), false);

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].role).toBe("user");
    expect(result.contents[0].parts[0].text).toBe("Hello, world!");
  });

  it("moves a system message to systemInstruction", () => {
    const body = openaiBody({
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hi!" },
      ],
    });
    const result = openaiToGeminiRequest("gemini-pro", body, false);

    expect(result.systemInstruction).toBeDefined();
    expect(result.systemInstruction.parts[0].text).toBe("You are a helpful assistant.");
    // System message should NOT appear in contents
    expect(result.contents.every(c => c.role !== "system")).toBe(true);
  });

  it("passes temperature to generationConfig", () => {
    const result = openaiToGeminiRequest("gemini-pro", openaiBody({ temperature: 0.7 }), false);
    expect(result.generationConfig.temperature).toBe(0.7);
  });

  it("passes max_tokens to generationConfig.maxOutputTokens", () => {
    const result = openaiToGeminiRequest("gemini-pro", openaiBody({ max_tokens: 1024 }), false);
    expect(result.generationConfig.maxOutputTokens).toBe(1024);
  });

  it("converts OpenAI tools to Gemini functionDeclarations", () => {
    const body = openaiBody({
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get current weather",
            parameters: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
          },
        },
      ],
    });
    const result = openaiToGeminiRequest("gemini-pro", body, false);

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].functionDeclarations[0].name).toBe("get_weather");
    expect(result.tools[0].functionDeclarations[0].parameters.type).toBe("object");
  });

  it("converts an assistant message to role 'model'", () => {
    const body = openaiBody({
      messages: [
        { role: "user", content: "Ping" },
        { role: "assistant", content: "Pong" },
      ],
    });
    const result = openaiToGeminiRequest("gemini-pro", body, false);

    const modelMsg = result.contents.find(c => c.role === "model");
    expect(modelMsg).toBeDefined();
    expect(modelMsg.parts[0].text).toBe("Pong");
  });

  it("includes DEFAULT_SAFETY_SETTINGS in the output", () => {
    const result = openaiToGeminiRequest("gemini-pro", openaiBody(), false);
    expect(Array.isArray(result.safetySettings)).toBe(true);
    expect(result.safetySettings.length).toBeGreaterThan(0);
  });

  it("handles empty messages array without throwing", () => {
    const result = openaiToGeminiRequest("gemini-pro", { messages: [] }, false);
    expect(result.contents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// openaiToClaudeRequest — OpenAI → Claude
// ---------------------------------------------------------------------------

describe("openaiToClaudeRequest()", () => {
  it("converts a simple user message to Claude messages format", () => {
    const result = openaiToClaudeRequest("claude-3-5-sonnet", openaiBody(), false);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    // Content may be array of blocks or a string
    const content = result.messages[0].content;
    const text = Array.isArray(content)
      ? content.find(b => b.type === "text")?.text
      : content;
    expect(text).toBe("Hello, world!");
  });

  it("moves system messages into result.system array", () => {
    const body = openaiBody({
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hi!" },
      ],
    });
    const result = openaiToClaudeRequest("claude-3-5-sonnet", body, false);

    expect(Array.isArray(result.system)).toBe(true);
    // System should include the Claude Code default prompt plus user's system
    const systemText = result.system.map(b => b.text).join(" ");
    expect(systemText).toContain("You are a helpful assistant.");
    // User message should be in messages, not system
    expect(result.messages.some(m => m.role === "user")).toBe(true);
  });

  it("sets model and stream on the result", () => {
    const result = openaiToClaudeRequest("claude-3-5-sonnet", openaiBody(), true);
    expect(result.model).toBe("claude-3-5-sonnet");
    expect(result.stream).toBe(true);
  });

  it("converts OpenAI tools to Claude tool format with proxy_ prefix", () => {
    const body = openaiBody({
      tools: [
        {
          type: "function",
          function: {
            name: "list_files",
            description: "List files in a directory",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        },
      ],
    });
    const result = openaiToClaudeRequest("claude-3-5-sonnet", body, false);

    expect(Array.isArray(result.tools)).toBe(true);
    // Claude OAuth adds a proxy_ prefix to tool names
    expect(result.tools[0].name).toBe("proxy_list_files");
    expect(result.tools[0].input_schema.type).toBe("object");
  });

  it("converts tool_choice 'required' to Claude { type: 'any' }", () => {
    const result = openaiToClaudeRequest(
      "claude-3-5-sonnet",
      openaiBody({ tool_choice: "required", tools: [] }),
      false
    );
    expect(result.tool_choice?.type).toBe("any");
  });

  it("converts tool_choice 'auto' to Claude { type: 'auto' }", () => {
    const result = openaiToClaudeRequest(
      "claude-3-5-sonnet",
      openaiBody({ tool_choice: "auto", tools: [] }),
      false
    );
    expect(result.tool_choice?.type).toBe("auto");
  });

  it("passes temperature when present", () => {
    const result = openaiToClaudeRequest(
      "claude-3-5-sonnet",
      openaiBody({ temperature: 0.5 }),
      false
    );
    expect(result.temperature).toBe(0.5);
  });

  it("merges consecutive user messages into a single message", () => {
    const body = {
      messages: [
        { role: "user", content: "First" },
        { role: "user", content: "Second" },
      ],
    };
    const result = openaiToClaudeRequest("claude-3-5-sonnet", body, false);

    // Claude requires alternating roles — consecutive user messages must be merged
    const userMessages = result.messages.filter(m => m.role === "user");
    expect(userMessages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// claudeToOpenAIResponse — Claude stream chunk → OpenAI SSE chunk
// ---------------------------------------------------------------------------

describe("claudeToOpenAIResponse()", () => {
  it("returns null for a null/undefined chunk", () => {
    const state = freshState();
    expect(claudeToOpenAIResponse(null, state)).toBeNull();
    expect(claudeToOpenAIResponse(undefined, state)).toBeNull();
  });

  it("emits a role:assistant delta on message_start", () => {
    const state = freshState();
    const chunk = {
      type: "message_start",
      message: { id: "msg_abc123", model: "claude-3-5-sonnet" },
    };
    const results = claudeToOpenAIResponse(chunk, state);

    expect(results).not.toBeNull();
    expect(results).toHaveLength(1);
    expect(results[0].choices[0].delta.role).toBe("assistant");
    expect(state.messageId).toBe("msg_abc123");
  });

  it("emits a content delta on content_block_delta (text_delta)", () => {
    const state = freshState({ messageId: "msg_001", model: "claude-3-5-sonnet" });
    const chunk = {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    };
    const results = claudeToOpenAIResponse(chunk, state);

    expect(results).not.toBeNull();
    expect(results[0].choices[0].delta.content).toBe("Hello");
  });

  it("emits finish_reason on message_delta with stop_reason", () => {
    const state = freshState({ messageId: "msg_001", model: "claude-3-5-sonnet" });
    const chunk = {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { input_tokens: 10, output_tokens: 20 },
    };
    const results = claudeToOpenAIResponse(chunk, state);

    const finalChunk = results.find(r => r.choices[0].finish_reason !== null);
    expect(finalChunk).toBeDefined();
    expect(finalChunk.choices[0].finish_reason).toBe("stop");
  });

  it("maps 'tool_use' stop_reason to 'tool_calls' finish_reason", () => {
    const state = freshState({ messageId: "msg_001", model: "claude-3-5-sonnet" });
    const chunk = {
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
    };
    const results = claudeToOpenAIResponse(chunk, state);

    const finalChunk = results.find(r => r.choices[0].finish_reason !== null);
    expect(finalChunk.choices[0].finish_reason).toBe("tool_calls");
  });

  it("maps 'max_tokens' stop_reason to 'length' finish_reason", () => {
    const state = freshState({ messageId: "msg_001", model: "claude-3-5-sonnet" });
    const chunk = {
      type: "message_delta",
      delta: { stop_reason: "max_tokens" },
    };
    const results = claudeToOpenAIResponse(chunk, state);

    const finalChunk = results.find(r => r.choices[0].finish_reason !== null);
    expect(finalChunk.choices[0].finish_reason).toBe("length");
  });

  it("emits tool_call delta on content_block_start for a tool_use block", () => {
    const state = freshState({ messageId: "msg_001", model: "claude-3-5-sonnet", toolCallIndex: 0 });
    const chunk = {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_001", name: "get_weather" },
    };
    const results = claudeToOpenAIResponse(chunk, state);

    expect(results).not.toBeNull();
    const toolChunk = results.find(r => r.choices[0].delta?.tool_calls);
    expect(toolChunk).toBeDefined();
    expect(toolChunk.choices[0].delta.tool_calls[0].function.name).toBe("get_weather");
  });

  it("accumulates input_json_delta into tool call arguments", () => {
    const state = freshState({ messageId: "msg_001", model: "claude-3-5-sonnet" });
    // First set up the tool call in state
    state.toolCalls.set(0, {
      index: 0,
      id: "toolu_001",
      type: "function",
      function: { name: "get_weather", arguments: '{"loc' },
    });

    const chunk = {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: 'ation":"NYC"}' },
    };
    const results = claudeToOpenAIResponse(chunk, state);

    expect(results).not.toBeNull();
    const argChunk = results.find(r => r.choices[0].delta?.tool_calls);
    expect(argChunk.choices[0].delta.tool_calls[0].function.arguments).toBe('ation":"NYC"}');
  });

  it("includes usage in the final chunk when usage is provided in message_delta", () => {
    const state = freshState({ messageId: "msg_001", model: "claude-3-5-sonnet" });
    const chunk = {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { input_tokens: 50, output_tokens: 100 },
    };
    const results = claudeToOpenAIResponse(chunk, state);

    const finalChunk = results.find(r => r.usage);
    expect(finalChunk).toBeDefined();
    expect(finalChunk.usage.prompt_tokens).toBeGreaterThanOrEqual(0);
    expect(finalChunk.usage.completion_tokens).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// geminiToOpenAIResponse — Gemini stream chunk → OpenAI SSE chunk
// ---------------------------------------------------------------------------

describe("geminiToOpenAIResponse()", () => {
  it("returns null for a null chunk", () => {
    const state = freshState();
    expect(geminiToOpenAIResponse(null, state)).toBeNull();
  });

  it("returns null when chunk has no candidates", () => {
    const state = freshState();
    const chunk = { candidates: [] };
    expect(geminiToOpenAIResponse(chunk, state)).toBeNull();
  });

  it("emits role:assistant delta on the first chunk", () => {
    const state = freshState();
    const chunk = {
      responseId: "resp_001",
      modelVersion: "gemini-pro",
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Hello!" }] },
        },
      ],
    };
    const results = geminiToOpenAIResponse(chunk, state);

    expect(results).not.toBeNull();
    // First emitted chunk should be the role initializer
    expect(results[0].choices[0].delta.role).toBe("assistant");
  });

  it("emits content delta for a text part", () => {
    const state = freshState();
    const chunk = {
      responseId: "resp_001",
      modelVersion: "gemini-pro",
      candidates: [
        {
          content: { role: "model", parts: [{ text: "World" }] },
        },
      ],
    };
    const results = geminiToOpenAIResponse(chunk, state);

    const textChunk = results.find(r => r.choices[0].delta?.content);
    expect(textChunk).toBeDefined();
    expect(textChunk.choices[0].delta.content).toBe("World");
  });

  it("emits tool_call delta for a functionCall part", () => {
    const state = freshState();
    const chunk = {
      responseId: "resp_001",
      modelVersion: "gemini-pro",
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "search_web",
                  args: { query: "vitest" },
                },
              },
            ],
          },
        },
      ],
    };
    const results = geminiToOpenAIResponse(chunk, state);

    const toolChunk = results.find(r => r.choices[0].delta?.tool_calls);
    expect(toolChunk).toBeDefined();
    expect(toolChunk.choices[0].delta.tool_calls[0].function.name).toBe("search_web");
    expect(JSON.parse(toolChunk.choices[0].delta.tool_calls[0].function.arguments)).toEqual({
      query: "vitest",
    });
  });

  it("emits a finish_reason chunk when candidate has finishReason", () => {
    const state = freshState();
    const chunk = {
      responseId: "resp_001",
      modelVersion: "gemini-pro",
      candidates: [
        {
          content: { role: "model", parts: [] },
          finishReason: "STOP",
        },
      ],
    };
    const results = geminiToOpenAIResponse(chunk, state);

    const finalChunk = results.find(r => r.choices[0].finish_reason !== null);
    expect(finalChunk).toBeDefined();
    expect(finalChunk.choices[0].finish_reason).toBe("stop");
  });

  it("includes usageMetadata in state when provided", () => {
    const state = freshState();
    const chunk = {
      responseId: "resp_001",
      modelVersion: "gemini-pro",
      candidates: [
        {
          content: { role: "model", parts: [] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 200,
        totalTokenCount: 300,
      },
    };
    geminiToOpenAIResponse(chunk, state);

    expect(state.usage).toBeDefined();
    expect(state.usage.prompt_tokens).toBe(100);
    expect(state.usage.completion_tokens).toBe(200);
    expect(state.usage.total_tokens).toBe(300);
  });

  it("handles the Antigravity wrapper format (chunk.response)", () => {
    const state = freshState();
    const chunk = {
      response: {
        responseId: "resp_001",
        modelVersion: "gemini-pro",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Wrapped response" }] },
          },
        ],
      },
    };
    const results = geminiToOpenAIResponse(chunk, state);

    expect(results).not.toBeNull();
    const textChunk = results.find(r => r.choices[0].delta?.content);
    expect(textChunk).toBeDefined();
    expect(textChunk.choices[0].delta.content).toBe("Wrapped response");
  });
});
