import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { fetchSidecar } from "@/lib/sidecar.js";

/**
 * GET /api/mesh/trust/[peerId]
 * Returns trust score for a peer. For local sidecar node, fetches from sidecar /trust.
 * For other peers, could query ServiceRegistry when configured (future).
 */
export async function GET(request, { params }) {
  try {
    const { peerId } = await params;
    if (!peerId) {
      return apiError(request, 400, "peerId required");
    }

    // For local sidecar: fetch from sidecar /trust.
    // Peer IDs from sidecar may be "sidecar-mock-node-id" or similar.
    const res = await fetchSidecar("/trust");

    if (!res.ok) {
      return NextResponse.json(
        { trust_score: null, error: "Sidecar unavailable" },
        { status: 200 }
      );
    }

    const data = await res.json();
    const nodeId = data.node_id || "";

    // If peerId matches our sidecar node, return trust score
    // Strict matching to avoid false positives (e.g., "node-1" matching "node-10")
    if (nodeId && peerId === nodeId) {
      return NextResponse.json({
        trust_score: data.trust_score ?? 100,
        requests_processed: data.requests_processed ?? 0,
        avg_latency_ms: data.avg_latency_ms ?? 0,
        error_count: data.error_count ?? 0,
      });
    }

    // For other peers: return null (ServiceRegistry integration would go here)
    return NextResponse.json({ trust_score: null });
  } catch (error) {
    console.error("Trust fetch error:", error);
    return NextResponse.json({ trust_score: null }, { status: 200 });
  }
}
