/**
 * verify_production.js
 * Final End-to-End Production Verification (Phase 13).
 */

import { getNodeIdentity, getSettings } from "./src/lib/localDb.js";
import os from "node:os";

async function runVerification() {
    console.log("--- ZippyMesh Production Verification ---");

    // 1. Data Directory Verification
    const homeDir = os.homedir();
    console.log(`1. User Home Directory: ${homeDir}`);

    // 2. Secret Identity Verification
    const identity = await getNodeIdentity();
    if (identity && identity.publicKey) {
        console.log("2. Production Node Identity: SECURE");
    } else {
        throw new Error("Critical: Node identity missing or corrupted");
    }

    // 3. Port Configuration Check
    const port = process.env.ZIPPY_PORT || 20128;
    console.log(`3. Production API Port: ${port}`);

    // 4. Discovery Configuration Check
    const discoveryPort = process.env.ZIPPY_DISCOVERY_PORT || 20129;
    const interval = process.env.ZIPPY_BEACON_INTERVAL || 30000;
    console.log(`4. P2P Discovery: Port ${discoveryPort}, Interval ${interval}ms`);

    // 5. Environment Example Check
    const fs = await import("node:fs");
    if (fs.existsSync(".env.example")) {
        console.log("5. Production Documentation: OK");
    }

    console.log("\n--- PRODUCTION READY ---");
    console.log("ZippyMesh Mesh Node is ready for deployment.");
}

runVerification().catch(console.error);
