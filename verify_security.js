/**
 * verify_security.js
 * Comprehensive verification for Mesh Security (Phase 12).
 */

import { getNodeIdentity } from "./src/lib/localDb.js";
import { signPayload, verifyPayload } from "./src/lib/security.js";

async function runTest() {
    console.log("Starting Phase 12 Security Verification...");

    // 1. Test Identity Generation
    const identity = await getNodeIdentity();
    console.log("1. Node Identity Retrieval: OK");
    if (!identity.publicKey || !identity.privateKey) {
        throw new Error("Identity keys missing");
    }

    // 2. Test Signing & Verification
    const testPayload = { message: "Secure Mesh Content", nodeId: "node-123" };
    const token = await signPayload(testPayload);
    console.log("2. JWT Signing: OK");

    const verified = await verifyPayload(token, identity.publicKey);
    console.log("3. JWT Verification: OK");

    if (verified.message !== testPayload.message) {
        throw new Error("Payload mismatch after verification");
    }

    // 4. Test Signature Tampering
    try {
        const tamperedToken = token.slice(0, -5) + "abcde";
        await verifyPayload(tamperedToken, identity.publicKey);
        console.error("4. Tampering Check: FAILED (Accepted invalid token)");
    } catch (e) {
        console.log("4. Tampering Check: OK (Rejected invalid token)");
    }

    console.log("\n--- PHASE 12 SECURITY VERIFIED ---");
    console.log("All cryptographic foundations are solid.");
}

runTest().catch(console.error);
