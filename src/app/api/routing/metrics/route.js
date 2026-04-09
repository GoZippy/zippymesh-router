import { NextResponse } from "next/server";
import { getRoutingStats, getSqliteDb } from "@/lib/localDb.js";

/**
 * GET /api/routing/metrics
 * Get routing analytics and decision statistics
 *
 * Query parameters:
 * - hours: Time window in hours (1-720, default: 24)
 * - intent: Filter by specific intent
 * - model: Filter by specific model
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get("hours") || "24");
    const intent = searchParams.get("intent");
    const model = searchParams.get("model");

    const stats = getRoutingStats({ hours, intent, model });

    return NextResponse.json(stats ?? { totalRequests: 0 });
  } catch (error) {
    console.error("[RoutingMetrics] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch routing metrics", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/routing/metrics
 * Reset all routing decisions and learning data.
 */
export async function DELETE() {
  try {
    const db = getSqliteDb();
    if (!db) return NextResponse.json({ ok: true, deleted: 0 });
    const { changes } = db.prepare("DELETE FROM routing_decisions").run();
    db.prepare("DELETE FROM routing_preferences").run();
    return NextResponse.json({ ok: true, deleted: changes });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
