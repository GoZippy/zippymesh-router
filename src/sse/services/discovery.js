import { maintenanceScheduler } from "@/lib/maintenance/scheduler.js";
import { discoveryService } from "@/lib/discovery/localDiscovery.js";
import { p2pDiscovery } from "@/lib/discovery/p2pDiscovery.js";
import { gossipDiscovery } from "@/lib/discovery/gossipDiscovery.js";

/**
 * Discovery Service
 * Coordinates background health checks and model discovery via MaintenanceScheduler.
 *
 * Peer discovery has two tiers (MSH01):
 *  - PRIMARY: `gossipDiscovery` sources peers from the sidecar's libp2p
 *    Gossipsub swarm (mDNS + bootstrap peers + Kademlia DHT). No socket of
 *    its own, so it runs by default.
 *  - SUPPLEMENTARY: the legacy UDP discovery beacon (`discoveryService` /
 *    `p2pDiscovery`) stays available as a LAN-only fallback, opt-in via
 *    ENABLE_P2P_DISCOVERY, for setups without the sidecar reachable.
 */

/**
 * Start the discovery loop
 * @param {number} intervalMs - Frequency of checks (default 30 minutes)
 */
export function startDiscoveryLoop(intervalMs = 30 * 60 * 1000) {
    maintenanceScheduler.start();
    gossipDiscovery.start();
    discoveryService.startBeacon();
    p2pDiscovery.start();
    console.log(`[Discovery] Maintenance Scheduler and P2P services started.`);
}

/**
 * Stop the discovery loop
 */
export function stopDiscoveryLoop() {
    maintenanceScheduler.stop();
    gossipDiscovery.stop();
    discoveryService.stopBeacon();
    p2pDiscovery.stop();
}

/**
 * Run manual maintenance check
 */
export async function runDiscovery() {
    return await maintenanceScheduler.runFullMaintenance();
}
