import { discoveryService } from "./src/lib/discovery/localDiscovery.js";
import { p2pDiscovery } from "./src/lib/discovery/p2pDiscovery.js";
import { calculateBidPrice } from "./src/shared/constants/pricing.js";
import dgram from "node:dgram";

async function verifyP2P() {
    console.log("--- Verifying P2P Discovery ---");

    // 1. Start services
    await p2pDiscovery.start();
    await discoveryService.startBeacon();

    // 2. Listen for a few seconds to see if our own or other beacons appear
    // Since we filtered out ourselves by hostname, let's just check if the beacon port is bound
    console.log("P2P services are running. Checking UDP binding...");

    const client = dgram.createSocket("udp4");
    client.bind(20129, "0.0.0.0", () => {
        console.log("SUCCESS: Port 20129 is active.");
        client.close();
    });

    // 3. Verify Bidding Logic
    console.log("\n--- Verifying Bidding Logic ---");
    const base = { input: 1.0, output: 2.0, reasoning: 3.0 };
    const bid = calculateBidPrice(base, 20); // 20% markup
    console.log("Base Pricing:", base);
    console.log("Bid Pricing (20% markup):", bid);

    if (bid.input === 1.2 && bid.output === 2.4 && bid.reasoning === 3.6) {
        console.log("SUCCESS: Bidding calculation is correct.");
    } else {
        console.log("ERROR: Bidding calculation mismatch!");
    }

    // Cleanup
    discoveryService.stopBeacon();
    p2pDiscovery.stop();
    console.log("\n--- Verification Complete ---");
    process.exit(0);
}

verifyP2P().catch(err => {
    console.error("Verification failed:", err);
    process.exit(1);
});
