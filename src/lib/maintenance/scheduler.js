import { connectionTester } from "./connectionTester.js";
import { modelDiscovery } from "./discovery.js";
import { getProviderConnections, getSettings } from "../localDb.js";

/**
 * Maintenance Scheduler
 * Handles background tasks like nightly validation and periodic health checks.
 */
export class MaintenanceScheduler {
    constructor() {
        this.nightlyTimer = null;
        this.healthCheckTimer = null;
    }

    /**
     * Start the scheduler
     */
    async start() {
        console.log("[Maintenance] Starting Scheduler...");

        // Schedule nightly run (3 AM)
        this.scheduleNightly();

        // Schedule periodic health checks (every 30 mins)
        this.startHealthChecks(30 * 60 * 1000);
    }

    /**
     * Schedule the nightly validation at 3 AM
     */
    scheduleNightly() {
        const now = new Date();
        const nightly = new Date();
        nightly.setHours(3, 0, 0, 0);

        if (nightly <= now) {
            nightly.setDate(nightly.getDate() + 1);
        }

        const delay = nightly.getTime() - now.getTime();
        console.log(`[Maintenance] Nightly validation scheduled in ${Math.round(delay / 1000 / 60)} minutes.`);

        this.nightlyTimer = setTimeout(async () => {
            await this.runFullMaintenance();
            this.scheduleNightly(); // Reschedule for next day
        }, delay);
    }

    /**
     * Start periodic health checks
     */
    startHealthChecks(intervalMs) {
        if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = setInterval(() => this.runQuickHealthCheck(), intervalMs);
    }

    /**
     * Run full maintenance: connection tests, model discovery, deprecation detection
     */
    async runFullMaintenance() {
        console.log("[Maintenance] Running FULL maintenance task...");
        const connections = await getProviderConnections({ isActive: true });

        for (const conn of connections) {
            await connectionTester.testConnection(conn);
        }

        await modelDiscovery.syncAll();
        const deprecations = await modelDiscovery.detectDeprecations();

        if (deprecations.length > 0) {
            console.warn(`[Maintenance] Detected ${deprecations.length} deprecated models in use!`);
            // In a real app, we might send an email or alert here
        }

        console.log("[Maintenance] Full maintenance completed.");
    }

    /**
     * Run quick health check: only test connections
     */
    async runQuickHealthCheck() {
        const settings = await getSettings();
        if (settings.disableAutoHealthCheck) return;

        console.log("[Maintenance] Running periodic health checks...");
        const connections = await getProviderConnections({ isActive: true });

        for (const conn of connections) {
            // Rotate testing to avoid hitting rate limits for just health checks
            // We only test if not tested in the last hour
            const lastTested = conn.lastTested ? new Date(conn.lastTested) : 0;
            if (Date.now() - lastTested > 60 * 60 * 1000) {
                await connectionTester.testConnection(conn);
            }
        }
    }

    stop() {
        if (this.nightlyTimer) clearTimeout(this.nightlyTimer);
        if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    }
}

export const maintenanceScheduler = new MaintenanceScheduler();
