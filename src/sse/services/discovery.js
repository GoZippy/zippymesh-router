import { maintenanceScheduler } from "@/lib/maintenance/scheduler.js";
import { discoveryService } from "@/lib/discovery/localDiscovery.js";
import { p2pDiscovery } from "@/lib/discovery/p2pDiscovery.js";

/**
 * Discovery Service
 * Coordinates background health checks and model discovery via MaintenanceScheduler.
 */

/**
 * Start the discovery loop
 * @param {number} intervalMs - Frequency of checks (default 30 minutes)
 */
export function startDiscoveryLoop(intervalMs = 30 * 60 * 1000) {
    maintenanceScheduler.start();
    discoveryService.startBeacon();
    p2pDiscovery.start();
    console.log(`[Discovery] Maintenance Scheduler and P2P services started.`);
}

/**
 * Stop the discovery loop
 */
export function stopDiscoveryLoop() {
    maintenanceScheduler.stop();
    discoveryService.stopBeacon();
    p2pDiscovery.stop();
}

/**
 * Run manual maintenance check
 */
export async function runDiscovery() {
    return await maintenanceScheduler.runFullMaintenance();
}
