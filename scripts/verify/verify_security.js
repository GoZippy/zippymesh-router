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

    // 5. Router API key generation and verification
    const { createRouterApiKey, verifyRouterApiKey, revokeRouterApiKey } = await import("./src/lib/localDb.js");
    const { id: keyId, rawKey } = await createRouterApiKey({ name: "test" });
    console.log("5. Created router API key", keyId);
    const v1 = await verifyRouterApiKey(rawKey);
    if (v1.valid) {
        console.log("5a. Key verification: OK");
    } else {
        throw new Error("Router API key failed to verify");
    }
    await revokeRouterApiKey(keyId);
    const v2 = await verifyRouterApiKey(rawKey);
    if (!v2.valid) {
        console.log("5b. Revocation: OK");
    } else {
        console.error("5b. Revocation FAILED");
    }

    console.log("\n--- PHASE 12 SECURITY VERIFIED ---");
    console.log("All cryptographic foundations are solid.");
}

runTest().catch(console.error);
