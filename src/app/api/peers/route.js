/**
 * @file route.js  — GET /api/peers
 * @description Peer resource advertisement API endpoint for ZippyMesh LLM Router (Task 2.1.2).
 * Returns the current list of discovered mesh peers with their capabilities.
 * Peers are discovered via the sidecar's Gossipsub peer advertisement protocol.
 */

import { readFile } from 'fs/promises';
import path from 'path';

// In-memory peer table — populated by sidecar via Gossipsub (shared via a local file or IPC)
// For API layer access, the sidecar writes its peer table to data/peer-table.json every 30s
const PEER_TABLE_PATH = path.resolve(process.cwd(), 'data/peer-table.json');

async function getPeerTable() {
    try {
        const raw = await readFile(PEER_TABLE_PATH, 'utf8');
        const peers = JSON.parse(raw);
        // Filter to only peers updated within the last 90 seconds
        const cutoff = Date.now() / 1000 - 90;
        return peers.filter(p => p.timestamp > cutoff);
    } catch {
        // Return sample data if peer table not yet populated
        return [
            {
                node_id: 'local',
                endpoint: 'http://localhost:20128',
                models: ['gpt-4o', 'claude-3-5-sonnet-20241022', 'gemini-2.0-flash'],
                gpu_vram_gb: 0,
                gpu_model: 'API Router (no local GPU)',
                latency_ms: 1,
                price_per_1k_tokens_zpc: 0.0,
                timestamp: Math.floor(Date.now() / 1000),
                status: 'self'
            }
        ];
    }
}

export async function GET(request) {
    try {
        const peers = await getPeerTable();

        return Response.json({
            count: peers.length,
            peers,
            updated_at: new Date().toISOString(),
            note: 'Peers are discovered via Gossipsub and expire after 90 seconds of inactivity.'
        }, {
            headers: {
                'Cache-Control': 'no-store',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(request) {
    // Allow external nodes to register themselves (for LAN/dev use without Gossipsub)
    try {
        const body = await request.json();
        const { node_id, endpoint, models, gpu_vram_gb, gpu_model, price_per_1k_tokens_zpc } = body;

        if (!node_id || !endpoint || !models?.length) {
            return Response.json({ error: 'node_id, endpoint, and models are required' }, { status: 400 });
        }

        const peer = {
            node_id,
            endpoint,
            models,
            gpu_vram_gb: gpu_vram_gb || 0,
            gpu_model: gpu_model || 'Unknown',
            latency_ms: null,
            price_per_1k_tokens_zpc: price_per_1k_tokens_zpc || 0.001,
            timestamp: Math.floor(Date.now() / 1000),
            status: 'registered'
        };

        // Append to peer table (simple append; sidecar manages dedup/expiry)
        let table = [];
        try {
            const raw = await readFile(PEER_TABLE_PATH, 'utf8');
            table = JSON.parse(raw);
        } catch { /* file doesn't exist yet */ }

        table = table.filter(p => p.node_id !== node_id); // replace existing
        table.push(peer);

        const { writeFile } = await import('fs/promises');
        await writeFile(PEER_TABLE_PATH, JSON.stringify(table, null, 2));

        return Response.json({ success: true, peer }, { status: 201 });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}
