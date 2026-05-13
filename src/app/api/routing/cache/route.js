import { NextResponse } from "next/server";
import { getCacheStats, purgeExpiredCache } from "@/lib/promptCache.js";

// GET /api/routing/cache - Get cache statistics
export async function GET() {
  try {
    const stats = getCacheStats();
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/routing/cache - Purge expired entries
export async function DELETE() {
  try {
    const removed = purgeExpiredCache();
    return NextResponse.json({ removed });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
