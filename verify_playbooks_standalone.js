
// Standalone Verification Script for Playbook Logic
// Includes the RoutingEngine logic inline to avoid module resolution issues during test

// --- MOCKED DEPENDENCIES ---
const mockRateLimiter = {
    checkLimit: async () => ({ allowed: true }),
    recordUsage: async () => { }
};

const getPricingForModel = async () => ({ input: 0.000005, output: 0.000015 }); // Mock pricing

// --- ROUTING ENGINE LOGIC (Copy of src/lib/routing/engine.js) ---

class RoutingEngine {
    constructor() {
        this.rateLimiter = mockRateLimiter;
    }

    async findRoute(requestContext) {
        const { model } = requestContext;

        // 1. Identify applicable Playbook
        // Mock: we pass playbooks in context for testing or use this.mockPlaybooks
        const playbooks = this.mockPlaybooks || [];
        const activePlaybook = this.selectPlaybook(playbooks, requestContext);

        // 2. Mock Connections
        // In the real app, this fetches from DB. Here we use this.mockConnections
        const equivalentModels = [model];
        let candidates = [];

        // Simple mock candidates generation
        for (const conn of (this.mockConnections || [])) {
            candidates.push({
                connection: conn,
                provider: conn.provider,
                model: conn.model,
                score: 0,
                reasons: []
            });
        }

        // 3. Filter by Rate Limits (Mocked to always pass)
        const availableCandidates = candidates;

        // 4. Score/Sort
        if (activePlaybook) {
            return this.executePlaybook(activePlaybook, availableCandidates, requestContext);
        } else {
            return this.defaultStrategy(availableCandidates, requestContext);
        }
    }

    selectPlaybook(playbooks, context) {
        const sorted = playbooks.filter(p => p.isActive).sort((a, b) => b.priority - a.priority);

        for (const pb of sorted) {
            if (pb.trigger) {
                if (pb.trigger.type === "intent") {
                    if (context.intent === pb.trigger.value) return pb;
                }
                else if (pb.trigger.type === "group") {
                    if (context.userGroup === pb.trigger.value) return pb;
                }
                continue;
            }
            return pb;
        }
        return null;
    }

    async defaultStrategy(candidates, context) {
        const scored = [];
        const GROUP_PRIORITY = { personal: 10, work: 20, team: 30, default: 40 };

        for (const cand of candidates) {
            const groupScore = GROUP_PRIORITY[cand.connection.group || "default"] || 99;
            const priority = cand.connection.priority || 999;
            const pricing = await getPricingForModel(cand.provider, cand.model) || { input: 0, output: 0 };
            const costScore = (pricing.input * 1000) + (pricing.output * 1000);
            const finalScore = (groupScore * 10000) + (priority * 10) + costScore;

            scored.push({
                ...cand,
                score: finalScore,
                costPer1k: costScore
            });
        }
        return scored.sort((a, b) => a.score - b.score);
    }

    async executePlaybook(playbook, candidates, context) {
        let filtered = [...candidates];

        // 1. Apply Filtering Rules
        for (const rule of playbook.rules || []) {
            if (rule.type === "filter-in") {
                filtered = filtered.filter(c => c.provider === rule.value);
            } else if (rule.type === "filter-out") {
                filtered = filtered.filter(c => c.provider !== rule.value);
            }
        }

        // 2. Score remaining
        const baseScored = await this.defaultStrategy(filtered, context);
        const scored = [];

        for (const cand of baseScored) {
            let score = cand.score;

            // Apply Boost/Penalty Rules
            for (const rule of playbook.rules || []) {
                const isMatch = cand.provider === rule.target || cand.model.includes(rule.target);

                if (isMatch) {
                    if (rule.type === "boost") {
                        score -= (rule.value || 1000);
                    } else if (rule.type === "penalty") {
                        score += (rule.value || 1000);
                    }
                }
            }
            scored.push({ ...cand, score });
        }

        return scored.sort((a, b) => a.score - b.score);
    }
}

// --- TEST EXECUTION ---

// Mock Data
const MOCK_PLAYBOOKS = [
    {
        id: "pb-1",
        name: "Coding Boost",
        isActive: true,
        priority: 10,
        trigger: { type: "intent", value: "coding" },
        rules: [
            { type: "boost", target: "anthropic", value: 50000 }
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
    { provider: "anthropic", model: "claude-3-5-sonnet", priority: 2, group: "personal" },
    { provider: "groq", model: "llama-3.1-70b", priority: 5, group: "personal" }
];

async function runTest() {
    console.log("Starting Standalone Logic Verification...");

    // Instantiate and inject data
    const engine = new RoutingEngine();
    engine.mockPlaybooks = MOCK_PLAYBOOKS;
    engine.mockConnections = MOCK_CONNECTIONS;

    console.log("\n--- Test 1: Default Strategy (No Intent) ---");
    // OpenAI should be first (Priority 1 vs 2)
    const res1 = await engine.findRoute({ model: "gpt-4o" });
    console.log("Winner:", res1[0].provider);
    if (res1[0].provider === "openai") console.log("PASS"); else console.error("FAIL - Expected openai");

    console.log("\n--- Test 2: Coding Intent (Boost Anthropic) ---");
    // Anthropic should win due to boost
    const res2 = await engine.findRoute({ model: "gpt-4o", intent: "coding" });
    console.log("Winner:", res2[0].provider);
    if (res2[0].provider === "anthropic") console.log("PASS"); else console.error("FAIL - Expected anthropic");

    console.log("\n--- Test 3: Strict Group (Filter Out OpenAI) ---");
    // OpenAI should be filtered out
    const res3 = await engine.findRoute({ model: "gpt-4o", userGroup: "strict" });
    const hasOpenAI = res3.some(c => c.provider === "openai");
    console.log("Has OpenAI:", hasOpenAI);
    if (!hasOpenAI) console.log("PASS"); else console.error("FAIL - OpenAI should be excluded");
}

runTest().catch(console.error);
