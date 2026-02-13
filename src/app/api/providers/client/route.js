import { NextResponse } from "next/server";

/**
 * GET /api/providers/client
 * Removed — previously returned all provider connections including sensitive
 * fields (API keys, tokens) without authentication for cloud sync.
 */
export async function GET() {
  return NextResponse.json({ error: "Endpoint removed" }, { status: 410 });
}
