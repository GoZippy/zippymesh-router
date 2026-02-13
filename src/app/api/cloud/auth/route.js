import { NextResponse } from "next/server";

/**
 * POST /api/cloud/auth
 * Removed — previously returned all provider API keys, access tokens, and
 * refresh tokens with zero authentication (auth checks were commented out).
 */
export async function POST() {
  return NextResponse.json({ error: "Endpoint removed" }, { status: 410 });
}
