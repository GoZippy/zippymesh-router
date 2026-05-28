/**
 * Queue Manager
 * Manages incoming requests to prevent bottlenecks and ensure priority-based processing.
 */
export class QueueManager {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.concurrencyLimit = 10; // Default concurrency
        this.activeCount = 0;
    }

    /**
     * Enqueue a request
     * @param {Function} task - Async function to execute
     * @param {object} metadata - metadata for priority (group, intent)
     * @returns {Promise<any>}
     */
    async enqueue(task, metadata = {}) {
        return new Promise((resolve, reject) => {
            const item = {
                task,
                metadata,
                priority: this.calculatePriority(metadata),
                resolve,
                reject,
                ts: Date.now()
            };

            this.queue.push(item);
            // Sort by priority (higher first) then arrival time
            this.queue.sort((a, b) => b.priority - a.priority || a.ts - b.ts);

            this.process();
        });
    }

    /**
     * Calculate priority based on user group and intent
     */
    calculatePriority(metadata) {
        const weights = {
            personal: 10,
            work: 20,
            team: 30,
            enterprise: 50,
            urgent: 100 // Intent based
        };

        let score = weights[metadata.group] || 0;
        if (metadata.intent === "urgent" || metadata.intent === "coding") {
            score += weights.urgent;
        }
        return score;
    }

    /**
     * Process the queue
     */
    async process() {
        if (this.activeCount >= this.concurrencyLimit || this.queue.length === 0) {
            return;
        }

        this.activeCount++;
        const item = this.queue.shift();

        try {
            const result = await item.task();
            item.resolve(result);
        } catch (err) {
            item.reject(err);
        } finally {
            this.activeCount--;
            this.process(); // Trigger next task
        }
    }

    setConcurrency(limit) {
        this.concurrencyLimit = limit;
        this.process();
    }
}

export const queueManager = new QueueManager();
