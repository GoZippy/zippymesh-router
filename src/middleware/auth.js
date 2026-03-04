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
        req.jwtClaims = jwt.verify(token, JWT_SECRET);
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

    // TODO (production): verify Dilithium signature
    // const isValid = dilithiumVerify(wallet_address, message, signature);
    // if (!isValid) return res.status(401).json({ error: 'Invalid wallet signature' });

    const payload = {
        wallet_address,
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
