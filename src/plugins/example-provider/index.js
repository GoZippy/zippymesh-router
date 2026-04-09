/**
 * Example Provider Plugin — ZippyMesh Community Edition
 *
 * This is the reference implementation for a provider plugin.
 * Copy this directory to ~/.zippy-mesh/plugins/example-provider/ to activate.
 *
 * Security note: Only install plugins from sources you trust.
 * Plugin interface version: 1
 */

const MOCK_RESPONSE = {
  id: "chatcmpl-example-001",
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model: "example-model",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: "Hello from the ZippyMesh example provider plugin! This is a mock response.",
      },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
};

const exampleProviderPlugin = {
  type: 'provider',
  name: 'example-provider',
  version: '1.0.0',
  description: 'Mock provider plugin — returns a hardcoded response for testing',

  async init(config) {
    console.log('[example-provider] Plugin initialized with config:', config);
  },

  async listModels() {
    return [
      {
        id: 'example-model',
        name: 'Example Model',
        description: 'Mock model for plugin testing',
        contextWindow: 4096,
        isFree: true,
        isLocal: false,
        capabilities: ['chat'],
        pricing: { inputPerMToken: 0, outputPerMToken: 0 },
      },
    ];
  },

  async chatCompletion(body) {
    // Echo back the user's last message content in the mock response
    const lastMsg = body.messages?.[body.messages.length - 1];
    const echo = lastMsg?.content ? `Echo: "${lastMsg.content}"` : MOCK_RESPONSE.choices[0].message.content;
    return {
      ...MOCK_RESPONSE,
      id: `chatcmpl-example-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      choices: [{ ...MOCK_RESPONSE.choices[0], message: { role: 'assistant', content: echo } }],
    };
  },

  async getHealth() {
    return { ok: true, message: 'Example provider is always healthy' };
  },
};

export default exampleProviderPlugin;
