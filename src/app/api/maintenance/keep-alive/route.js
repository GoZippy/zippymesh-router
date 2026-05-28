import { NextResponse } from "next/server";
import { triggerKeepAliveCycle } from "@/lib/connectionKeepAlive.js";
import { getLocalDb } from "@/lib/localDb.js";

/**
 * GET /api/maintenance/keep-alive
 * Returns the current connection health status overview.
 */
export async function GET() {
  try {
    const db = getLocalDb();

    const summary = db.prepare(`
      SELECT
        testStatus,
        COUNT(*) as count,
        MIN(lastTested) as oldestTest,
        MAX(lastTested) as newestTest
      FROM provider_connections
      WHERE isEnabled IS NOT 0
      GROUP BY testStatus
    `).all();

    const rateLimited = db.prepare(`
      SELECT COUNT(*) as c FROM provider_connections
      WHERE rateLimitedUntil IS NOT NULL AND rateLimitedUntil > ?
    `).get(new Date().toISOString())?.c ?? 0;

    const totalEnabled = db.prepare(`
      SELECT COUNT(*) as c FROM provider_connections WHERE isEnabled IS NOT 0
    `).get()?.c ?? 0;

    return NextResponse.json({
      totalEnabled,
      rateLimited,
      byStatus: summary,
      schedulerActive: true, // keep-alive is always running after /api/init
      message: "Use POST to trigger an immediate keep-alive cycle",
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/maintenance/keep-alive
 * Immediately triggers a keep-alive cycle (tests stale/unknown/error connections now).
 */
export async function POST() {
  try {
    triggerKeepAliveCycle();
    return NextResponse.json({
      ok: true,
      message: "Keep-alive cycle triggered. Check server logs for results.",
      triggeredAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
