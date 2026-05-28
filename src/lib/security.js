import * as jose from "jose";
import { getNodeIdentity } from "./localDb.js";

/**
 * Sign a payload with the node's private key
 * @param {object} payload 
 * @returns {Promise<string>} JWT
 */
export async function signPayload(payload) {
    const { privateKey } = await getNodeIdentity();

    // Convert PEM to KeyObject
    const { importPKCS8 } = jose;
    const key = await importPKCS8(privateKey, "EdDSA");

    return await new jose.SignJWT(payload)
        .setProtectedHeader({ alg: "EdDSA" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(key);
}

/**
 * Verify a JWT with a public key
 * @param {string} jwt 
 * @param {string} publicKeyPem 
 * @returns {Promise<object>} payload
 */
export async function verifyPayload(jwt, publicKeyPem) {
    const { importSPKI, jwtVerify } = jose;
    const key = await importSPKI(publicKeyPem, "EdDSA");

    const { payload } = await jwtVerify(jwt, key);
    return payload;
}
