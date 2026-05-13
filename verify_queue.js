import { queueManager } from "./src/lib/routing/queueManager.js";

async function testQueue() {
    console.log("Starting QueueManager test...");

    const tasks = [];
    for (let i = 0; i < 10; i++) {
        tasks.push(
            queueManager.enqueue(async () => {
                const id = i;
                const priority = i % 3 === 0 ? "urgent" : "default";
                console.log(`[Task ${id}] Starting (Priority: ${priority})...`);
                await new Promise(resolve => setTimeout(resolve, 500));
                console.log(`[Task ${id}] Finished.`);
                return id;
            }, { intent: i % 3 === 0 ? "urgent" : "default" })
        );
    }

    const results = await Promise.all(tasks);
    console.log("All tasks completed:", results);
}

testQueue().catch(console.error);
