
// Verify Full Orchestrator Flow with Routing & Persistence

import { handleOrchestratedChat } from "./src/sse/services/orchestrator.js";
import { updateProviderConnection, saveRoutingPlaybook, getRateLimitState } from "./src/lib/localDb.js"; // We need to inject real data into localDb for this test

// Mock handleChatCore
const mockHandleChatCore = async ({ modelInfo }) => {
    return {
        success: true,
        status: 200,
        usage: { tokens: 50 },
        providerHeaders: { "x-ratelimit-remaining-requests": "20" }
    };
};

async function setupTestData() {
    // 1. Create Connections
    await updateProviderConnection("openai-conn", {
        id: "openai-conn",
        provider: "openai",
        model: "gpt-4",
        isActive: true,
        priority: 1,
        group: "default"
    });

    await updateProviderConnection("anthropic-conn", {
        id: "anthropic-conn",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        isActive: true,
        priority: 2, // Lower priority normally
        group: "default"
    });

    // 2. Create Playbook
    await saveRoutingPlaybook({
        id: "test-pb-1",
        name: "Coding Boost",
        isActive: true,
        priority: 100,
        trigger: { type: "intent", value: "coding" },
        rules: [
            { type: "boost", target: "anthropic", value: 50000 }
        ]
    });
}

async function runTest() {
    console.log("Setting up test data...");
    await setupTestData();

    console.log("\n--- Test 1: Normal Request (Should pick OpenAI due to Priority 1) ---");
    await handleOrchestratedChat({
        body: { model: "gpt-4", messages: [] },
        modelStr: "gpt-4",
        handleChatCore: mockHandleChatCore,
        log: { info: (tag, msg) => console.log(`[${tag}] ${msg}`), warn: console.warn },
        params: { user: { group: "default" } },
        equivalentModels: ["openai:gpt-4", "anthropic:claude-3-5-sonnet"] // Mocking resolution
    });

    console.log("\n--- Test 2: Coding Intent Request (Should pick Anthropic due to Boost) ---");
    await handleOrchestratedChat({
        body: { model: "gpt-4", messages: [], intent: "coding" }, // INTENT HERE
        modelStr: "gpt-4",
        handleChatCore: mockHandleChatCore,
        log: { info: (tag, msg) => console.log(`[${tag}] ${msg}`), warn: console.warn },
        params: { user: { group: "default" } },
        equivalentModels: ["openai:gpt-4", "anthropic:claude-3-5-sonnet"]
    });

    // Check Persistence
    // Wait for auto-save (we set it to 10s, but here we can check if state object exists in memory or file)
    // Actually validation of persistence is hard in a quick script without waiting.
    // We can check if getRateLimitState returns something after usage.

    const state = await getRateLimitState();
    console.log("\nRate Limit State present:", !!state);
}

// Ensure localDb mock/adapter works
// For this test to work with ES modules and localDb, we might run into the same issue as before.
// But since we are modifying the REAL files, we should try running it.
// If it fails, I'll use the standalone approach again.

runTest().catch(console.error);
