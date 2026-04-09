/**
 * Default Smart Playbooks for ZippyMesh LLM Router.
 * These are injected on first run or when migrating old databases.
 */

export const SMART_PLAYBOOKS = [
    // === ZippyMesh Mode-Based Playbooks (OpenClaw/Kilo Code compatible) ===
    {
        id: "pb-zippymesh-code-focus",
        name: "zippymesh/code-focus",
        description: "High-quality code generation. Claude Sonnet, DeepSeek, Qwen-Coder with intelligent fallback.",
        isActive: true,
        priority: 200,
        trigger: { type: "intent", value: "code" },
        rules: [
            { type: "boost", target: "claude-sonnet", value: 80000 },
            { type: "boost", target: "deepseek-coder", value: 70000 },
            { type: "boost", target: "qwen-2.5-coder", value: 65000 },
            { type: "boost", target: "gpt-4o", value: 60000 },
            { type: "boost", target: "codestral", value: 50000 },
            { type: "stack", target: "anthropic,deepinfra,openai,groq,ollama,lmstudio", value: "failover" }
        ]
    },
    {
        id: "pb-zippymesh-fast-code",
        name: "zippymesh/Fast-Code",
        description: "Low-latency code gen. Groq, Cerebras, local models for speed.",
        isActive: true,
        priority: 150,
        trigger: { type: "intent", value: "fast_code" },
        rules: [
            { type: "sort-by-fastest", target: "*" },
            { type: "boost", target: "groq", value: 80000 },
            { type: "boost", target: "cerebras", value: 75000 },
            { type: "boost", target: "ollama", value: 70000 },
            { type: "boost", target: "lmstudio", value: 70000 },
            { type: "stack", target: "groq,cerebras,ollama,lmstudio,fireworks,togetherai", value: "failover" }
        ]
    },
    {
        id: "pb-zippymesh-architect",
        name: "zippymesh/architect",
        description: "System design, planning. Claude Opus, GPT-5, Gemini Pro.",
        isActive: true,
        priority: 180,
        trigger: { type: "intent", value: "architect" },
        rules: [
            { type: "boost", target: "claude-opus", value: 90000 },
            { type: "boost", target: "gpt-5", value: 80000 },
            { type: "boost", target: "gemini-2.5-pro", value: 75000 },
            { type: "boost", target: "deepseek-r1", value: 60000 },
            { type: "stack", target: "anthropic,openai,gemini,deepinfra,openrouter", value: "failover" }
        ]
    },
    {
        id: "pb-zippymesh-ask",
        name: "zippymesh/ask",
        description: "General Q&A. Cost-effective: GLM, Kilo, Groq free tiers.",
        isActive: true,
        priority: 100,
        trigger: { type: "intent", value: "ask" },
        rules: [
            { type: "sort-by-cheapest", target: "*" },
            { type: "boost", target: "kilo", value: 70000 },
            { type: "boost", target: "glm-4", value: 65000 },
            { type: "boost", target: "groq", value: 55000 },
            { type: "boost", target: "gpt-4o-mini", value: 45000 },
            { type: "stack", target: "kilo,groq,cerebras,github_models,ollama,openai,anthropic", value: "failover" }
        ]
    },
    {
        id: "pb-zippymesh-debug",
        name: "zippymesh/debug",
        description: "Debugging and troubleshooting. Claude, DeepSeek, GPT-4.",
        isActive: true,
        priority: 170,
        trigger: { type: "intent", value: "debug" },
        rules: [
            { type: "boost", target: "claude-sonnet", value: 80000 },
            { type: "boost", target: "deepseek-v3", value: 70000 },
            { type: "boost", target: "gpt-4o", value: 65000 },
            { type: "boost", target: "qwen-2.5-coder", value: 50000 },
            { type: "stack", target: "anthropic,deepinfra,openai,fireworks,ollama", value: "failover" }
        ]
    },
    {
        id: "pb-zippymesh-review",
        name: "zippymesh/review",
        description: "Code review and audits. Claude, GPT-4, Gemini.",
        isActive: true,
        priority: 160,
        trigger: { type: "intent", value: "review" },
        rules: [
            { type: "boost", target: "claude-sonnet", value: 75000 },
            { type: "boost", target: "gpt-4o", value: 70000 },
            { type: "boost", target: "deepseek-v3", value: 60000 },
            { type: "boost", target: "gemini-pro", value: 55000 },
            { type: "stack", target: "anthropic,openai,gemini,deepinfra,openrouter", value: "failover" }
        ]
    },
    // === Legacy Playbooks (backward compatibility) ===
    {
        id: "pb-coding-default",
        name: "Coding Priorities",
        description: "Prioritizes high-end coding models like Claude 3.5 Sonnet and Qwen-2.5-Coder.",
        isActive: true,
        priority: 95,
        rules: [
            { type: "boost", target: "cc/claude-3-5-sonnet", value: 50000 },
            { type: "boost", target: "qw/qwen-2.5-coder", value: 40000 },
            { type: "boost", target: "openai/gpt-4o", value: 30000 }
        ]
    },
    {
        id: "pb-low-cost-default",
        name: "Budget Routing",
        description: "Routes requests to free or low-cost providers like Groq, Cerebras, and GitHub Models first.",
        isActive: true,
        priority: 50,
        rules: [
            { type: "filter-in", target: "groq", value: "groq" },
            { type: "filter-in", target: "cerebras", value: "cerebras" },
            { type: "filter-in", target: "github_models", value: "github_models" },
            { type: "boost", target: "groq", value: 10000 },
            { type: "boost", target: "cerebras", value: 10000 }
        ]
    },
    {
        id: "pb-privacy-default",
        name: "Privacy First",
        description: "Strictly routes to local models (Ollama, LM Studio) to ensure zero data leakage.",
        isActive: true,
        priority: 10,
        rules: [
            { type: "filter-in", target: "local", value: "local" },
            { type: "filter-out", target: "openai", value: "openai" },
            { type: "filter-out", target: "anthropic", value: "anthropic" }
        ]
    },
    {
        id: "pb-balanced-default",
        name: "Performance Balanced",
        description: "A balanced approach between cost and latency for general purpose use.",
        isActive: true,
        priority: 0,
        rules: [
            { type: "stack", target: "ag,cc,cx,qw,openai,anthropic,gemini", value: "failover" }
        ]
    }
];

export const SMART_PLAYBOOK_TEMPLATES = [
    // === ZippyMesh Mode-Based Playbooks (Kilo Code compatible) ===
    {
        id: "tpl-code-focus",
        name: "zippymesh/code-focus",
        description: "High-quality code generation. Claude Sonnet, DeepSeek, Qwen-Coder with intelligent fallback.",
        trigger: { type: "intent", value: "code" },
        rules: [
            { type: "boost", target: "claude-sonnet", value: 80000 },
            { type: "boost", target: "deepseek-coder", value: 70000 },
            { type: "boost", target: "qwen-2.5-coder", value: 65000 },
            { type: "boost", target: "gpt-4o", value: 60000 },
            { type: "boost", target: "codestral", value: 50000 },
            { type: "stack", target: "anthropic,deepinfra,openai,groq,ollama,lmstudio", value: "failover" }
        ]
    },
    {
        id: "tpl-fast-code",
        name: "zippymesh/Fast-Code",
        description: "Low-latency code gen. Groq, Cerebras, local models for speed.",
        trigger: { type: "intent", value: "fast_code" },
        rules: [
            { type: "sort-by-fastest", target: "*" },
            { type: "boost", target: "groq", value: 80000 },
            { type: "boost", target: "cerebras", value: 75000 },
            { type: "boost", target: "ollama", value: 70000 },
            { type: "boost", target: "lmstudio", value: 70000 },
            { type: "stack", target: "groq,cerebras,ollama,lmstudio,fireworks,togetherai", value: "failover" }
        ]
    },
    {
        id: "tpl-architect",
        name: "zippymesh/architect",
        description: "System design, planning. Claude Opus, GPT-5, Gemini Pro for complex reasoning.",
        trigger: { type: "intent", value: "architect" },
        rules: [
            { type: "boost", target: "claude-opus", value: 90000 },
            { type: "boost", target: "gpt-5", value: 80000 },
            { type: "boost", target: "gemini-2.5-pro", value: 75000 },
            { type: "boost", target: "deepseek-r1", value: 60000 },
            { type: "stack", target: "anthropic,openai,gemini,deepinfra,openrouter", value: "failover" }
        ]
    },
    {
        id: "tpl-ask",
        name: "zippymesh/ask",
        description: "General Q&A. Cost-effective: GLM, Qwen, Kilo free tiers.",
        trigger: { type: "intent", value: "ask" },
        rules: [
            { type: "sort-by-cheapest", target: "*" },
            { type: "boost", target: "kilo", value: 70000 },
            { type: "boost", target: "glm-4", value: 65000 },
            { type: "boost", target: "groq", value: 55000 },
            { type: "boost", target: "gpt-4o-mini", value: 45000 },
            { type: "stack", target: "kilo,groq,cerebras,github_models,ollama,openai,anthropic", value: "failover" }
        ]
    },
    {
        id: "tpl-debug",
        name: "zippymesh/debug",
        description: "Debugging and troubleshooting. Claude (tracing), DeepSeek, GPT-4.",
        trigger: { type: "intent", value: "debug" },
        rules: [
            { type: "boost", target: "claude-sonnet", value: 80000 },
            { type: "boost", target: "deepseek-v3", value: 70000 },
            { type: "boost", target: "gpt-4o", value: 65000 },
            { type: "boost", target: "qwen-2.5-coder", value: 50000 },
            { type: "stack", target: "anthropic,deepinfra,openai,fireworks,ollama", value: "failover" }
        ]
    },
    {
        id: "tpl-review",
        name: "zippymesh/review",
        description: "Code review and audits. Claude (thorough), GPT-4 (broad knowledge).",
        trigger: { type: "intent", value: "review" },
        rules: [
            { type: "boost", target: "claude-sonnet", value: 75000 },
            { type: "boost", target: "gpt-4o", value: 70000 },
            { type: "boost", target: "deepseek-v3", value: 60000 },
            { type: "boost", target: "gemini-pro", value: 55000 },
            { type: "stack", target: "anthropic,openai,gemini,deepinfra,openrouter", value: "failover" }
        ]
    },
    {
        id: "tpl-orchestrator",
        name: "zippymesh/orchestrator",
        description: "Multi-agent coordination. GPT-4 (tools), Claude (reasoning), Gemini (multimodal).",
        trigger: { type: "intent", value: "orchestrator" },
        rules: [
            { type: "boost", target: "gpt-4o", value: 80000 },
            { type: "boost", target: "claude-sonnet", value: 72000 },
            { type: "boost", target: "gemini-2.5-pro", value: 65000 },
            { type: "stack", target: "openai,anthropic,gemini,deepinfra,openrouter", value: "failover" }
        ]
    },
    {
        id: "tpl-tool-use",
        name: "zippymesh/tool-agent",
        description: "Agentic tool-calling. GPT-4o (best tools), Claude, Gemini.",
        trigger: { type: "intent", value: "tool_use" },
        rules: [
            { type: "boost", target: "gpt-4o", value: 85000 },
            { type: "boost", target: "claude-sonnet", value: 75000 },
            { type: "boost", target: "gemini-2.5-pro", value: 70000 },
            { type: "stack", target: "openai,anthropic,gemini,groq,deepinfra", value: "failover" }
        ]
    },
    {
        id: "tpl-document",
        name: "zippymesh/document",
        description: "Long document analysis. Gemini (1M ctx), Claude (200K), GPT-4 Turbo (128K).",
        trigger: { type: "intent", value: "document" },
        rules: [
            { type: "boost", target: "gemini-2.5-pro", value: 80000 },
            { type: "boost", target: "claude-sonnet", value: 70000 },
            { type: "boost", target: "gpt-4-turbo", value: 65000 },
            { type: "stack", target: "gemini,anthropic,openai,deepinfra,openrouter", value: "failover" }
        ]
    },
    // === Free-Only Playbooks ===
    {
        id: "tpl-free-code",
        name: "free/code-focus",
        description: "Code generation using only free models. No paid API calls.",
        trigger: { type: "intent", value: "free_code" },
        rules: [
            { type: "filter-out", target: "openai", value: "openai" },
            { type: "filter-out", target: "anthropic", value: "anthropic" },
            { type: "boost", target: "llama-3.3-70b", value: 60000 },
            { type: "boost", target: "qwen-2.5-coder", value: 50000 },
            { type: "boost", target: "deepseek-coder", value: 48000 },
            { type: "stack", target: "groq,cerebras,github_models,kilo,ollama,lmstudio", value: "failover" }
        ]
    },
    {
        id: "tpl-free-fast",
        name: "free/fast",
        description: "Ultra-fast free inference. Groq, Cerebras, local models.",
        trigger: { type: "intent", value: "free_fast" },
        rules: [
            { type: "filter-out", target: "openai", value: "openai" },
            { type: "filter-out", target: "anthropic", value: "anthropic" },
            { type: "sort-by-fastest", target: "*" },
            { type: "boost", target: "groq", value: 80000 },
            { type: "boost", target: "cerebras", value: 75000 },
            { type: "stack", target: "groq,cerebras,ollama,lmstudio", value: "failover" }
        ]
    },
    {
        id: "tpl-free-reasoning",
        name: "free/reasoning",
        description: "Complex reasoning with free models. Large Llama, DeepSeek-R1.",
        trigger: { type: "intent", value: "free_reasoning" },
        rules: [
            { type: "filter-out", target: "openai", value: "openai" },
            { type: "filter-out", target: "anthropic", value: "anthropic" },
            { type: "boost", target: "llama-3.3-70b", value: 65000 },
            { type: "boost", target: "deepseek-r1", value: 60000 },
            { type: "boost", target: "qwen-max", value: 55000 },
            { type: "stack", target: "groq,kilo,github_models,ollama,lmstudio,cerebras", value: "failover" }
        ]
    },
    {
        id: "tpl-free-chat",
        name: "free/chat",
        description: "General chat with free models. Balanced speed and quality.",
        trigger: { type: "intent", value: "free_chat" },
        rules: [
            { type: "filter-out", target: "openai", value: "openai" },
            { type: "filter-out", target: "anthropic", value: "anthropic" },
            { type: "sort-by-cheapest", target: "*" },
            { type: "boost", target: "llama-3.3", value: 50000 },
            { type: "boost", target: "gemma-2", value: 45000 },
            { type: "stack", target: "kilo,groq,cerebras,github_models,cohere,ollama,lmstudio", value: "failover" }
        ]
    },
    {
        id: "tpl-free-auto",
        name: "free/auto",
        description: "Universal free-tier failover. Intelligent model selection based on intent. Never fails.",
        trigger: { type: "intent", value: "free_auto" },
        rules: [
            { type: "filter-out", target: "openai", value: "openai" },
            { type: "filter-out", target: "anthropic", value: "anthropic" },
            { type: "sort-by-fastest", target: "*" },
            { type: "boost", target: "llama-3.3-70b", value: 70000 },
            { type: "boost", target: "qwen-2.5-coder", value: 65000 },
            { type: "boost", target: "deepseek-v3", value: 60000 },
            { type: "boost", target: "gemma-2-27b", value: 55000 },
            { type: "boost", target: "mixtral-8x7b", value: 50000 },
            { type: "stack", target: "groq,cerebras,kilo,github_models,cohere,deepinfra,ollama,lmstudio", value: "failover" }
        ]
    },
    {
        id: "tpl-local-only",
        name: "local/privacy-strict",
        description: "Local inference only. No data leaves your network.",
        trigger: { type: "intent", value: "local" },
        rules: [
            { type: "filter-in", target: "ollama", value: "ollama" },
            { type: "filter-in", target: "lmstudio", value: "lmstudio" },
            { type: "filter-in", target: "llamacpp", value: "llamacpp" },
            { type: "boost", target: "deepseek-coder", value: 60000 },
            { type: "boost", target: "qwen-2.5-coder", value: 55000 },
            { type: "boost", target: "codellama", value: 50000 },
            { type: "stack", target: "ollama,lmstudio,llamacpp", value: "failover" }
        ]
    },
    // === Special Purpose ===
    {
        id: "tpl-urgent-premium",
        name: "urgent/premium",
        description: "Maximum quality for critical tasks. Top-tier paid models only.",
        trigger: { type: "intent", value: "urgent" },
        rules: [
            { type: "boost", target: "claude-opus", value: 95000 },
            { type: "boost", target: "claude-sonnet", value: 90000 },
            { type: "boost", target: "gpt-5", value: 88000 },
            { type: "boost", target: "gpt-4o", value: 85000 },
            { type: "stack", target: "anthropic,openai,gemini,deepinfra,openrouter", value: "failover" }
        ]
    },
    {
        id: "tpl-budget-quality",
        name: "mixed/budget-quality",
        description: "Smart cost optimization. Free tiers first, paid fallback.",
        rules: [
            { type: "sort-by-cheapest", target: "*" },
            { type: "boost", target: "groq", value: 70000 },
            { type: "boost", target: "cerebras", value: 68000 },
            { type: "boost", target: "kilo", value: 65000 },
            { type: "boost", target: "ollama", value: 60000 },
            { type: "boost", target: "gpt-4o-mini", value: 40000 },
            { type: "stack", target: "groq,cerebras,kilo,github_models,ollama,lmstudio,deepinfra,openai,anthropic", value: "failover" }
        ]
    },
    {
        id: "tpl-bot-runner",
        name: "Bot Runner",
        description: "Low-latency automation with economical fallback.",
        trigger: { type: "intent", value: "bot_runner" },
        rules: [
            { type: "filter-in", target: "groq", value: "groq" },
            { type: "filter-in", target: "cerebras", value: "cerebras" },
            { type: "stack", target: "groq,cerebras,openrouter", value: "failover" }
        ]
    },
    {
        id: "tpl-simple-local",
        name: "Simple Tasks (Local First)",
        description: "Route generic/simple tasks to local models when available.",
        trigger: { type: "intent", value: "generic" },
        rules: [
            { type: "boost", target: "ollama", value: 50000 },
            { type: "boost", target: "lmstudio", value: 50000 },
            { type: "boost", target: "local", value: 50000 },
            { type: "stack", target: "ollama,lmstudio,openai,anthropic,gemini,groq", value: "failover" }
        ]
    }
];

export const GUARDRAILS_PII_DEFAULTS = [
  {
    id: "pii-email",
    name: "Email Address",
    description: "Redacts email addresses from requests",
    type: "pii",
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b",
    replacement: "[REDACTED:email]",
    isActive: true,
    severity: "medium",
  },
  {
    id: "pii-phone-us",
    name: "US Phone Number",
    description: "Redacts US phone numbers",
    type: "pii",
    pattern: "\\b(\\+1[-.\\s]?)?(\\(?\\d{3}\\)?[-.\\s]?)?\\d{3}[-.\\s]?\\d{4}\\b",
    replacement: "[REDACTED:phone]",
    isActive: true,
    severity: "medium",
  },
  {
    id: "pii-ssn",
    name: "Social Security Number",
    description: "Redacts US Social Security Numbers",
    type: "pii",
    pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b",
    replacement: "[REDACTED:ssn]",
    isActive: true,
    severity: "high",
  },
  {
    id: "pii-credit-card",
    name: "Credit Card Number",
    description: "Redacts credit card numbers (16-digit patterns)",
    type: "pii",
    pattern: "\\b\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}\\b",
    replacement: "[REDACTED:credit_card]",
    isActive: true,
    severity: "high",
  },
  {
    id: "prompt-injection",
    name: "Prompt Injection Detector",
    description: "Detects common prompt injection attempts",
    type: "safety",
    pattern: "(?i)(ignore (previous|all) instructions|disregard your system prompt|you are now|your new instructions are|forget everything you know|act as if you have no restrictions)",
    replacement: "[BLOCKED:prompt_injection]",
    isActive: false, // Off by default — enable in privacy-strict playbooks
    severity: "critical",
    action: "block", // block vs redact
  },
];

export const INITIAL_SETTINGS = {
    cloudEnabled: false,
    stickyRoundRobinLimit: 3,
    requireLogin: true,
    requireApiKey: false,
    trustedLanCidrs: ["10.0.0.0/16", "127.0.0.0/8", "::1/128"], // IPs in these ranges bypass API key requirement
    enforceDeviceIdVerification: false,
    routingMode: "auto", // auto | playbook | default
    defaultPlaybookId: "pb-balanced-default",
    enableCrossProviderFailover: true,
    autoFailoverToEquivalents: true,
    preferFreeOnRateLimit: false,
    enableRoutingMemory: false,
    externalRouterUrl: "", // Optional: POST routing context, receive suggested model order to merge
    preferLocalForSimpleTasks: true,
    autoDiscovery: true,
    isDemoMode: false,
    dashboardView: "simple",
    advancedDashboard: true,
    pricingValidation: true,
    reconciliationEngine: true,
    providerTransparency: true,
    autoProviderCatalogSync: true,
    providerCatalogSyncIntervalMinutes: 30,
    providerCatalogLastSyncedAt: null,
    providerCatalogLastSyncSummary: null,
    providerCatalogSyncHealth: {},
    minorVariancePct: 3,
    warnVariancePct: 7,
    criticalVariancePct: 12,
    reconciliationMinSampleSize: 30,
    firstRun: true,
    
    // Intelligent Auto Routing & Never-Fail Settings
    enableNlpIntentDetection: true,           // Use NLP to detect request intent
    enableSessionAwareRouting: true,          // Track session context for routing consistency
    enableNeverFailRouting: true,             // Always failover to something (never return error)
    neverFailFallbackPlaybook: "free/chat",   // Default failover playbook when all else fails
    
    // Failover Configuration
    failoverConfig: {
        preferredStack: [],                    // User-defined ordered provider list
        avoidProviders: [],                    // Providers to never use in failover
        allowPaid: true,                       // Allow paid providers in failover chain
        allowFree: true,                       // Allow free tier providers
        allowLocal: true,                      // Allow local providers (Ollama, LMStudio)
        allowZippyMesh: false,                 // Allow ZippyMesh P2P network (future)
        maxRetries: 10,                        // Maximum failover attempts before giving up
        tagPreferences: {                      // Model tags to prefer by intent
            code: ["claude-sonnet", "deepseek-coder", "qwen-coder", "gpt-4o"],
            chat: ["llama-70b", "gemini-flash", "gpt-4o-mini"],
            reasoning: ["claude-opus", "gpt-4", "deepseek-r1"],
            fast: ["groq", "cerebras", "ollama"]
        }
    },
    
    // Global Account Pool table: column order (visible columns only; user can reorder and toggle)
    poolTableColumns: {
        order: ["provider", "account", "group", "priority", "status", "actions"]
    },

    // ZippyMesh Network (Future)
    zippyMeshConfig: {
        enableP2pFailover: false,              // Failover to ZippyMesh P2P network
        enableHostedEndpoints: false,          // Use zippymesh.com hosted endpoints
        nodeId: null,                          // User's ZippyMesh node ID (if running)
        communityPoolEnabled: false            // Participate in community model pool
    },

    // Semantic Cache (Experimental — requires local Ollama)
    semanticCacheEnabled: false,
    semanticCacheThreshold: 0.92,              // Cosine similarity threshold (0.80–0.99)
    semanticCacheEmbeddingModel: "nomic-embed-text",

    // Webhooks — fire-and-forget event delivery
    webhooks: [],                              // Array of { id, url, events, headers, enabled }
};

