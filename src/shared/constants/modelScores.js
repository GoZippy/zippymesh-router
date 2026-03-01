export const MODEL_SCORES = {
  "claude-3-5-sonnet": {
    confidence: "benchmark_backed",
    intents: { code: 0.94, reasoning: 0.92, tool_use: 0.89, chat: 0.9 },
    source: "livebench",
    sourceUrl: "https://livebench.ai/#/",
  },
  "gpt-4o": {
    confidence: "benchmark_backed",
    intents: { code: 0.9, reasoning: 0.88, tool_use: 0.87, chat: 0.93 },
    source: "lmarena",
    sourceUrl: "https://lmarena.ai/",
  },
  "gemini-2.5-pro": {
    confidence: "benchmark_backed",
    intents: { code: 0.87, reasoning: 0.91, tool_use: 0.82, chat: 0.88 },
    source: "provider_docs",
    sourceUrl: "https://deepmind.google/",
  },
  "qwen-2.5-coder": {
    confidence: "metadata_inferred",
    intents: { code: 0.84, reasoning: 0.74, tool_use: 0.68, chat: 0.72 },
    source: "metadata_inference",
    sourceUrl: "",
  },
  "llama-3.1-70b-instruct": {
    confidence: "metadata_inferred",
    intents: { code: 0.79, reasoning: 0.76, tool_use: 0.62, chat: 0.8 },
    source: "metadata_inference",
    sourceUrl: "",
  },
};

