import { NextResponse } from 'next/server';
import { getLastHeartbeat } from '@/lib/mesh/heartbeat.js';

/**
 * GET /api/mesh/heartbeat
 * Returns the most recently built heartbeat payload for this node.
 * Non-libp2p peers can poll this endpoint to fetch this node's status.
 */
export async function GET() {
  const heartbeat = getLastHeartbeat();

  if (!heartbeat) {
    return NextResponse.json(
      { error: 'Heartbeat not yet generated — server still initialising' },
      { status: 503 }
    );
  }

  return NextResponse.json(heartbeat);
}
