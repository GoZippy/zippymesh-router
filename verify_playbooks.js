
// Verify Playbook Logic
import { RoutingEngine } from "./src/lib/routing/engine.js";

// Mock Data
const MOCK_PLAYBOOKS = [
    {
        id: "pb-1",
        name: "Coding Boost",
        isActive: true,
        priority: 10,
        trigger: { type: "intent", value: "coding" },
        rules: [
            { type: "boost", target: "anthropic", value: 50000 } // Super boost to override defaults
        ]
    },
    {
        id: "pb-2",
        name: "No OpenAI",
        isActive: true,
        priority: 5,
        trigger: { type: "group", value: "strict" },
        rules: [
            { type: "filter-out", value: "openai" }
        ]
    }
];

const MOCK_CONNECTIONS = [
    { provider: "openai", model: "gpt-4o", priority: 1, group: "personal" },
    { provider: "anthropic", model: "claude-3-5-sonnet", priority: 2, group: "personal" }, // Lower priority initially
    { provider: "groq", model: "llama-3.1-70b", priority: 5, group: "personal" }
];

// Mock Routing Engine methods
class TestRoutingEngine extends RoutingEngine {
    constructor() {
        super();
        this.mockPlaybooks = MOCK_PLAYBOOKS;
        this.mockConnections = MOCK_CONNECTIONS;
    }

    // Override to return mock data
    async findRoute(context) {
        // Bypass db fetches for test
        const activePlaybook = this.selectPlaybook(this.mockPlaybooks, context);
        console.log(`Selected Playbook: ${activePlaybook ? activePlaybook.name : "None"}`);

        // Mock candidates
        const candidates = this.mockConnections.map(c => ({
            connection: c,
            provider: c.provider,
            model: c.model,
            score: 0,
            reasons: []
        }));

        if (activePlaybook) {
            return this.executePlaybook(activePlaybook, candidates, context);
        }
        return this.defaultStrategy(candidates, context);
    }
}

async function runTest() {
    const engine = new TestRoutingEngine();

    console.log("--- Test 1: Default Strategy (No Intent) ---");
    // OpenAI should be first (Priority 1 vs 2)
    const res1 = await engine.findRoute({ model: "gpt-4o" });
    console.log("Winner:", res1[0].provider);
    if (res1[0].provider === "openai") console.log("PASS"); else console.error("FAIL");

    console.log("\n--- Test 2: Coding Intent (Boost Anthropic) ---");
    // Anthropic should win despite lower priority, due to boost
    const res2 = await engine.findRoute({ model: "gpt-4o", intent: "coding" });
    console.log("Winner:", res2[0].provider);
    if (res2[0].provider === "anthropic") console.log("PASS"); else console.error("FAIL");

    console.log("\n--- Test 3: Strict Group (Filter Out OpenAI) ---");
    // OpenAI should be filtered out
    const res3 = await engine.findRoute({ model: "gpt-4o", userGroup: "strict" });
    const hasOpenAI = res3.some(c => c.provider === "openai");
    console.log("Has OpenAI:", hasOpenAI);
    if (!hasOpenAI) console.log("PASS"); else console.error("FAIL");
}

runTest().catch(console.error);
