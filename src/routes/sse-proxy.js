/**
 * @file sse-proxy.js
 * @description SSE streaming proxy for ZippyMesh sidecar (Task 2.1.3).
 * Accepts POST /v1/chat/completions with {stream: true} and pipes the
 * upstream SSE response (from the best GPU peer or local) directly to the client.
 * Compatible with OpenAI streaming API clients.
 */

const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const { URL } = require('url');

const LOCAL_INFERENCE_URL = process.env.INFERENCE_URL || 'http://localhost:11434/v1';

/**
 * Select the best inference endpoint for the given model.
 * @param {string} model
 * @param {Map<string, object>} peerTable
 * @returns {string} base URL
 */
function selectEndpoint(model, peerTable) {
    const candidates = [];
    for (const [, peer] of peerTable) {
        if (
            peer.models?.includes(model) &&
            peer.endpoint &&
            peer.endpoint !== 'local' &&
            Date.now() - peer.lastSeen < 90_000
        ) {
            candidates.push(peer);
        }
    }
    if (!candidates.length) return LOCAL_INFERENCE_URL;
    // Highest VRAM first
    candidates.sort((a, b) => (b.gpuVramGb || 0) - (a.gpuVramGb || 0));
    return candidates[0].endpoint;
}

/**
 * POST /v1/chat/completions  (streaming)
 * Proxies to the best peer and streams SSE chunks back to the client.
 */
router.post('/v1/chat/completions', async (req, res) => {
    const body = req.body;

    // Only handle streaming requests in this router
    if (!body?.stream) {
        return res.status(400).json({
            error: { message: 'This endpoint only handles stream:true requests.' }
        });
    }

    const model = body.model || 'llama3';
    // peerTable is injected via app.locals from main.js
    const peerTable = req.app.locals.peerTable || new Map();
    const endpoint = selectEndpoint(model, peerTable);
    const targetUrl = new URL(`${endpoint.replace(/\/$/, '')}/chat/completions`);

    console.info(`[SSE Proxy] Streaming ${model} → ${targetUrl}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const upstreamOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: targetUrl.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(process.env.INFERENCE_API_KEY
                ? { Authorization: `Bearer ${process.env.INFERENCE_API_KEY}` }
                : {}),
        },
    };

    const transport = targetUrl.protocol === 'https:' ? https : http;
    const upstreamReq = transport.request(upstreamOptions, (upstreamRes) => {
        upstreamRes.on('data', (chunk) => {
            try { res.write(chunk); } catch { /* client disconnected */ }
        });
        upstreamRes.on('end', () => {
            try { res.end(); } catch { /* already closed */ }
        });
        upstreamRes.on('error', (err) => {
            console.error('[SSE Proxy] Upstream stream error:', err.message);
            try {
                res.write(`data: {"error":{"message":"Upstream stream interrupted: ${err.message}"}}\n\n`);
                res.end();
            } catch { /* ignore */ }
        });
    });

    upstreamReq.on('error', (err) => {
        console.error('[SSE Proxy] Upstream request error:', err.message);
        if (!res.headersSent) {
            res.status(502).json({ error: { message: `Could not reach inference peer: ${err.message}` } });
        }
    });

    req.on('close', () => upstreamReq.destroy());

    upstreamReq.write(JSON.stringify(body));
    upstreamReq.end();
});

module.exports = router;
