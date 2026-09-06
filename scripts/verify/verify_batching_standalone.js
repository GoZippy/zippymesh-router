/**
 * verify_batching_standalone.js
 * Verifies the "Race Mode" parallel orchestration logic in a standalone environment.
 */

// This is a direct copy of the logic implemented in orchestrator.js
async function executeBatchChat(params, candidates, batchRule) {
    const { handleChatCore, log } = params;
    const parallelLimit = batchRule.parallel || 2;
    const batchCandidates = candidates.slice(0, parallelLimit);

    const abortController = new AbortController();
    const startTime = Date.now();

    const tasks = batchCandidates.map(async (candidate) => {
        const { connection, modelInfo } = candidate;
        const accountId = connection.id.slice(0, 8);

        console.log(`[Batch] Starting ${modelInfo.provider} via ${accountId}`);

        try {
            const result = await handleChatCore({
                modelInfo,
                signal: abortController.signal,
            });

            if (result.success) {
                const latency = Date.now() - startTime;
                console.log(`[Batch] Winner identified: ${modelInfo.provider} (${latency}ms)`);

                // Cancel other pending requests
                abortController.abort();
                return result;
            } else {
                throw new Error("Candidate failed");
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log(`[Batch] ${modelInfo.provider} aborted`);
                return { aborted: true };
            }
            console.log(`[Batch] Candidate ${accountId} failed: ${err.message}`);
            throw err;
        }
    });

    try {
        // Promise.any returns the first fulfilled promise (success)
        return await Promise.any(tasks);
    } catch (aggregateError) {
        console.error("All batch candidates failed");
        return { success: false, error: "All failed" };
    }
}

// Mock handleChatCore with delay
async function mockHandleChatCore({ modelInfo, signal }) {
    const delay = modelInfo.provider === "fast-provider" ? 100 : 500;

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve({
                success: true,
                latency: delay
            });
        }, delay);

        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timeout);
            });
        }
    });
}

async function runTest() {
    console.log("Running standalone Batch Logic Verification...");

    const candidates = [
        { connection: { id: "acc1-slow" }, modelInfo: { provider: "slow-provider" } },
        { connection: { id: "acc2-fast" }, modelInfo: { provider: "fast-provider" } }
    ];

    const batchRule = { parallel: 2, strategy: "race" };

    const result = await executeBatchChat({ handleChatCore: mockHandleChatCore }, candidates, batchRule);

    console.log("Final Result:", JSON.stringify(result, null, 2));

    if (result.success && result.latency === 100) {
        console.log("--- TEST PASSED: Fastest provider won the race. ---");
    } else {
        console.error("--- TEST FAILED ---");
    }
}

runTest();
