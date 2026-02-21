
// Basic verification script for Routing API
// Since we can't easily fetch against the running Next.js dev server from here without knowing the port/state,
// we will simulate the logic by importing the API handlers directly if possible, or 
// just use the localDb models to verify persistence.

// Given the environment constraints, testing the localDb persistence via models is the most reliable way 
// to verify backend logic without a running HTTP server.

import {
    createRoutingPlaybook,
    getRoutingPlaybooks,
    updateRoutingPlaybook,
    deleteRoutingPlaybook,
    updateRateLimitConfig,
    getRateLimitConfigs
} from "./src/lib/localDb.js"; // Direct import from localDb to bypass Next.js API layer for this test

async function testApiLogic() {
    console.log("--- Verifying Routing Playbooks CRUD ---");

    // 1. Create
    console.log("Creating playbook...");
    const playbook = await createRoutingPlaybook({
        name: "Test Playbook",
        description: "A test playbook",
        priority: 10,
        rules: [{ type: "intent", value: "coding", target: "deepseek" }]
    });
    console.log(`Created: ${playbook.id} - ${playbook.name}`);

    // 2. Read
    const all = await getRoutingPlaybooks();
    const found = all.find(p => p.id === playbook.id);
    if (found) {
        console.log("PASS: Playbook retrieved successfully.");
    } else {
        console.error("FAIL: Playbook not found.");
    }

    // 3. Update
    console.log("Updating playbook...");
    const updated = await updateRoutingPlaybook(playbook.id, { description: "Updated desc" });
    if (updated.description === "Updated desc") {
        console.log("PASS: Playbook updated successfully.");
    } else {
        console.error("FAIL: Update failed.");
    }

    // 4. Delete
    console.log("Deleting playbook...");
    await deleteRoutingPlaybook(playbook.id);
    const allAfter = await getRoutingPlaybooks();
    if (!allAfter.find(p => p.id === playbook.id)) {
        console.log("PASS: Playbook deleted successfully.");
    } else {
        console.error("FAIL: Delete failed.");
    }

    console.log("\n--- Verifying Rate Limit Configs ---");

    // 1. Update Config
    const providerId = "test-provider";
    const config = {
        buckets: [
            { name: "rpm", window_seconds: 60, window_type: "rolling", unit: "requests", value_hint: 100 }
        ]
    };

    console.log(`Updating config for ${providerId}...`);
    await updateRateLimitConfig(providerId, config);

    // 2. Read Config
    const configs = await getRateLimitConfigs();
    if (configs[providerId] && configs[providerId].buckets[0].value_hint === 100) {
        console.log("PASS: Rate limit config saved and retrieved.");
    } else {
        console.error("FAIL: Rate limit config mismatch.");
    }
}

testApiLogic().catch(e => console.error(e));
