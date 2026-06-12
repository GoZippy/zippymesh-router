import { NextResponse } from 'next/server';
import { getActivePeers } from '@/lib/mesh/peerState.js';

/**
 * GET /api/mesh/peers
 * Returns all active mesh peers (seen within 90s).
 * Used by routing engine to find peer models for forwarding.
 */
export async function GET() {
  const peers = getActivePeers();

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    peers,
    total: peers.length,
  });
}
