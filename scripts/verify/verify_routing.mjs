
import { RoutingEngine } from "./src/lib/routing/engine.js";
import { DEFAULT_RATE_LIMITS } from "./src/lib/localDb.js"; // Ensure we can access this or mock DB
import { RateLimiter } from "./src/lib/routing/rateLimiter.js";

// Mocking dependencies if running standalone (or run this via node with proper setup)
// Since this is likely ESM and depends on other modules, running it might be tricky without full app context.
// Better to create a unit test or a script that imports specific parts.

// Let's assume we run this in the environment where imports work.

async function testRouting() {
    console.log("Initializing Routing Engine...");
    const engine = new RoutingEngine();

    // 1. Manually inject configs into RateLimiter (since localDb might be empty in this test env)
    // We can use engine.rateLimiter.configs = ... if we expose it or use a public method.
    // But engine.rateLimiter.init() calls getRateLimitConfigs() from localDb.
    // If we run this script, we need localDb to work or we need to mock it.

    // For this verification, let's rely on the actual code paths.
    // We will check if engine.findRoute rejects candidates.

    // Mock Context
    const ctx = {
        model: "llama-3.1-8b-instant",
        equivalentModels: ["groq:llama-3.1-8b-instant", "cerebras:llama3.1-8b"],
        estimatedTokens: 100
    };

    console.log(`\n--- Test 1: Basic Route Finding ---`);
    console.log(`Requesting: ${ctx.model}`);
    try {
        const routes = await engine.findRoute(ctx);
        console.log(`Found ${routes.length} candidates.`);
        routes.forEach((r, i) => console.log(`  [${i}] ${r.provider}/${r.model} (Score: ${r.score})`));

        if (routes.length > 0) {
            console.log("PASS: Found candidates");
        } else {
            // This might fail if no providers are configured in localDb
            console.log("WARN: No candidates found. Ensure providerConnections exist in localDb.");
        }
    } catch (err) {
        console.error("FAIL: findRoute threw error", err);
    }

    // Rate Limit Test
    console.log(`\n--- Test 2: Rate Limit Enforcement ---`);
    // We will simulate spamming calls to trigger rate limit on a mock provider if possible,
    // or manually trigger it on 'groq' if it's in the list.

    // This is hard to verify without active providers in DB.
    // But we can test `RateLimiter` class directly with mocked configs.

    const limiter = new RateLimiter();
    limiter.configs = DEFAULT_RATE_LIMITS; // Inject defaults

    const provider = "groq";
    const model = "llama-3.1-8b-instant";

    // Groq default RPM is 30.
    console.log(`Testing Groq RPM limit (30)...`);
    let allowedCount = 0;

    for (let i = 0; i < 35; i++) {
        const res = await limiter.checkLimit(provider, model, { estimatedTokens: 10 });
        if (res.allowed) {
            allowedCount++;
            await limiter.recordUsage(provider, model, { tokens: 10 });
        } else {
            console.log(`Blocked at request #${i + 1}: ${res.reason}`);
        }
    }

    console.log(`Allowed ${allowedCount} requests.`);
    if (allowedCount === 30) {
        console.log("PASS: Rate limiter enforced 30 RPM.");
    } else {
        console.log(`FAIL: Expected 30 allowed, got ${allowedCount}`);
    }

    console.log(`\n--- Test 3: Header Synchronization ---`);
    // Reset limiter
    limiter.memoryStore.windows = {};

    // Simulate a request that returns headers indicating 1 request remaining
    // Config: value_hint = 30. If remaining = 1, count should become 29.
    const headers = {
        "x-ratelimit-remaining-requests": "1",
        "x-ratelimit-reset-requests": "5" // 5 seconds
    };

    await limiter.recordUsage(provider, model, { tokens: 10 }, headers);

    // Check state
    const key = limiter.getBucketKey(provider, "llama-3-1-8b-instant-rpm", model);
    const state = limiter.memoryStore.windows[key];
    console.log("Synced State:", state);

    if (state.count === 29) {
        console.log("PASS: State count synced to 29 (30 - 1).");
    } else {
        console.log(`FAIL: Expected count 29, got ${state.count}`);
    }

    // Now make 1 more request (should succeed)
    const check1 = await limiter.checkLimit(provider, model);
    console.log(`Next request allowed? ${check1.allowed}`);
    if (check1.allowed) {
        await limiter.recordUsage(provider, model, { tokens: 10 });
    }

    // Now make another (should fail, as we hit 30)
    const check2 = await limiter.checkLimit(provider, model);
    console.log(`Limit hit? ${!check2.allowed}`);
    if (!check2.allowed) {
        console.log("PASS: Limit correctly enforced after sync.");
    } else {
        console.log("FAIL: Should have blocked request.");
    }
}

testRouting().catch(e => console.error(e));
