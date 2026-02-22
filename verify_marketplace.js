import { getP2pOffers, createP2pSubscription, getP2pSubscriptions, updateP2pOffers } from "./src/lib/localDb.js";
import { v4 as uuidv4 } from "uuid";

async function verifyPhase8() {
    console.log("--- Phase 8 Verification: Marketplace & Ordering ---");

    // 1. Simulate Peer Discovery
    const mockPeerNode = {
        id: uuidv4(),
        name: "Test-Peer-Node",
        baseUrl: "http://192.168.1.50:20128/api/v1",
        avgLatency: 120,
        avgTps: 45,
        models: ["llama-3.1-8b-instant"]
    };

    console.log("1. Simulating peer discovery and offer update...");
    await updateP2pOffers([mockPeerNode]);

    const offers = await getP2pOffers();
    const found = offers.find(o => o.name === "Test-Peer-Node");

    if (found) {
        console.log(`   SUCCESS: Offer found! ID: ${found.id}, Latency: ${found.latency}ms`);
    } else {
        console.error("   FAILED: Offer not found in DB.");
        process.exit(1);
    }

    // 2. Simulate Subscription (Ordering)
    console.log("\n2. Simulating 'Buy Access' (Subscription)...");
    const sub = await createP2pSubscription(found.id, found.name);

    const allSubs = await getP2pSubscriptions();
    const hasSub = allSubs.find(s => s.offerId === found.id);

    if (hasSub && hasSub.status === "active") {
        console.log(`   SUCCESS: Subscription created! ID: ${hasSub.id}, Status: ${hasSub.status}`);
    } else {
        console.error("   FAILED: Subscription not created correctly.");
        process.exit(1);
    }

    console.log("\n--- Verification Complete Strategy ---");
}

verifyPhase8().catch(console.error);
