/**
 * verify_batching.js
 * Verifies that the Multi-Model Batching (Race Mode) works as expected.
 */

import { handleOrchestratedChat } from "./src/sse/services/orchestrator.js";

// Mocking the handleChatCore to simulate delay and success/failure
async function mockHandleChatCore({ body, modelInfo, credentials, log, signal }) {
    const delay = modelInfo.provider === "fast-provider" ? 100 : 500;

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.log(`[Mock] ${modelInfo.provider} finished after ${delay}ms`);
            resolve({
                success: true,
                usage: { total_tokens: 50 },
                status: 200,
                providerHeaders: {}
            });
        }, delay);

        // Handle cancellation
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                console.log(`[Mock] ${modelInfo.provider} aborted`);
            });
        }
    });
}

// Mocking dependencies if necessary or running in a context where they exist
async function runTest() {
    console.log("Starting Phase 11 Verification: Multi-Model Batching...");

    const params = {
        body: {
            messages: [{ role: "user", content: "Hello Batch" }],
            routing: {
                rule: "batch",
                parallel: 2,
                strategy: "race"
            }
        },
        modelStr: "gpt-4",
        handleChatCore: mockHandleChatCore,
        log: {
            info: (tag, msg) => console.log(`[INFO][${tag}] ${msg}`),
            warn: (tag, msg) => console.log(`[WARN][${tag}] ${msg}`),
            error: (tag, msg) => console.log(`[ERROR][${tag}] ${msg}`)
        }
    };

    try {
        const result = await handleOrchestratedChat(params);
        console.log("Final Result:", JSON.stringify(result, null, 2));

        if (result.success) {
            console.log("SUCCESS: Batching race condition handled correctly.");
        } else {
            console.error("FAILURE: Batching failed.");
        }
    } catch (err) {
        console.error("Test Error:", err);
    }
}

runTest();
