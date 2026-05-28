import { NextResponse } from "next/server";
import { getLearningSummary, resetRoutingIntelligenceCache, analyzeRoutingMemory } from "@/lib/routingIntelligence.js";
import { getSqliteDb } from "@/lib/localDb.js";

/**
 * GET /api/routing/intelligence
 * Returns the routing intelligence summary (top models per intent).
 */
export async function GET() {
  try {
    const summary = getLearningSummary();
    const { totalSamples } = analyzeRoutingMemory();
    return NextResponse.json({ summary, totalSamples });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * DELETE /api/routing/intelligence
 * Clears the routing_decisions table (routing memory reset).
 */
export async function DELETE() {
  try {
    const db = getSqliteDb();
    if (db) {
      db.prepare("DELETE FROM routing_decisions").run();
      db.prepare("DELETE FROM routing_preferences").run();
    }
    resetRoutingIntelligenceCache();
    return NextResponse.json({ ok: true, message: "Routing memory cleared." });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
