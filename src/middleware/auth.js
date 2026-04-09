/**
 * @file auth.js
 * @description JWT authentication middleware for ZippyMesh LLM Router (Task 2.3.2).
 * - Localhost requests: always allowed (no JWT required)
 * - LAN / Internet requests: require a valid Bearer JWT
 * - POST /auth/token: issues a JWT given a valid ZippyCoin wallet signature
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

if (!process.env.JWT_SECRET) {
    console.warn('[Auth] JWT_SECRET not set in .env — using ephemeral secret. Tokens will not survive restarts.');
}

/** Determine if a remote IP is a local/loopback address */
function isLocalOrigin(remoteAddress) {
    if (!remoteAddress) return false;
    const cleaned = remoteAddress.replace('::ffff:', '');
    return cleaned === '127.0.0.1' || cleaned === '::1' || cleaned === 'localhost';
}

/**
 * Middleware: require JWT for remote (non-localhost) requests.
 * Adds `req.jwtClaims` if authenticated.
 */
export function jwtAuthMiddleware(req, res, next) {
    // Always allow localhost
    if (isLocalOrigin(req.socket?.remoteAddress)) {
        req.jwtClaims = { source: 'localhost', trusted: true };
        return next();
    }

    // Extract Bearer token
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Remote access requires a Bearer JWT. POST /auth/token to obtain one.',
            docs: '/docs/CONNECTIVITY.md'
        });
    }

    try {
        const claims = jwt.verify(token, JWT_SECRET);

        // Dilithium key-type pass-through stub.
        // When a token carries keyType: "dilithium" it was issued for a
        // post-quantum wallet.  Full ML-DSA-65 verification requires a
        // Node.js binding for FIPS 204 (e.g. liboqs) which is not yet
        // bundled.  Until then we log a warning and allow the request
        // through, the same as any other valid JWT.
        //
        // TODO (production): once wallet-generator emits real Dilithium keys,
        // replace the pass-through below with:
        //   const { MlDsa65 } = require('@noble/post-quantum/ml-dsa');
        //   const pk = Buffer.from(claims.dilithium_pk, 'hex');   // from JWT
        //   const sig = Buffer.from(req.headers['x-dilithium-sig'] || '', 'hex');
        //   if (!MlDsa65.verify(pk, Buffer.from(token), sig))
        //     return res.status(401).json({ error: 'Invalid Dilithium signature' });
        if (claims.keyType === 'dilithium') {
            console.warn(
                `[Auth] Dilithium JWT accepted without post-quantum verification for wallet ${claims.wallet_address}. ` +
                'Full ML-DSA-65 verification is pending liboqs integration.'
            );
        }

        req.jwtClaims = claims;
        next();
    } catch (err) {
        const expired = err.name === 'TokenExpiredError';
        return res.status(401).json({
            error: expired ? 'Token expired' : 'Invalid token',
            message: expired ? 'Your JWT has expired. POST /auth/token to get a new one.' : 'The provided JWT is invalid.',
        });
    }
}

/**
 * Route handler: POST /auth/token
 * Issues a JWT given:
 *   { wallet_address: "zpc1...", signature: "<hex>", message: "<challenge>" }
 *
 * For now, validates that wallet_address and signature are present.
 * In production: verify the Dilithium signature against the ZippyCoin public key.
 */
export function issueTokenHandler(req, res) {
    const { wallet_address, signature, message } = req.body || {};

    if (!wallet_address || !signature) {
        return res.status(400).json({
            error: 'Bad request',
            message: 'Provide wallet_address and signature in request body.'
        });
    }

    // SECURITY WARNING: Dilithium signature verification is NOT implemented.
    // The signature field is accepted but never validated. Any wallet_address
    // with any signature will receive a valid JWT. This MUST be replaced before
    // production deployment.
    //
    // What needs to be implemented:
    //   1. Obtain the ZippyCoin public key for the given wallet_address (on-chain lookup).
    //   2. Use a post-quantum Dilithium library (e.g. liboqs Node.js binding) to verify
    //      that `signature` is a valid Dilithium signature over `message` by that key.
    //   3. Reject (HTTP 401) if verification fails.
    //
    // TODO (production): verify Dilithium signature
    // const isValid = dilithiumVerify(wallet_address, message, signature);
    // if (!isValid) return res.status(401).json({ error: 'Invalid wallet signature' });
    console.warn(
        '[Auth] SECURITY BYPASS: Dilithium signature verification is not implemented. ' +
        `Issuing JWT for wallet ${wallet_address} without verifying signature. ` +
        'Do NOT use this build in production.'
    );

    // Detect whether the wallet uses a Dilithium (post-quantum) key.
    // The wallet-generator sets keyType: "dilithium" in the token request body.
    // Classic wallets omit the field or set it to "ed25519".
    const keyType = req.body?.keyType || 'ed25519';

    const payload = {
        wallet_address,
        keyType,
        scope: 'api:full',
        iat: Math.floor(Date.now() / 1000),
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    console.log(`[Auth] Issued JWT for wallet ${wallet_address}`);

    return res.json({
        token,
        expires_in: JWT_EXPIRY,
        wallet_address,
        note: 'Present this token as: Authorization: Bearer <token>'
    });
}
