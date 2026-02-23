/**
 * Default Smart Playbooks for ZippyMesh LLM Router.
 * These are injected on first run or when migrating old databases.
 */

export const SMART_PLAYBOOKS = [
    {
        id: "pb-coding-default",
        name: "Coding Priorities",
        description: "Prioritizes high-end coding models like Claude 3.5 Sonnet and Qwen-2.5-Coder.",
        isActive: true,
        priority: 100,
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

export const INITIAL_SETTINGS = {
    cloudEnabled: false,
    stickyRoundRobinLimit: 3,
    requireLogin: true,
    defaultPlaybookId: "pb-balanced-default",
    autoDiscovery: true,
    isDemoMode: false
};

