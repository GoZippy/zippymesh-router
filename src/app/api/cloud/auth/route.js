import { apiError } from "@/lib/apiErrors.js";

/**
 * POST /api/cloud/auth
 * Removed — previously returned all provider API keys, access tokens, and
 * refresh tokens with zero authentication (auth checks were commented out).
 */
export async function POST(request) {
  return apiError(request, 410, "Endpoint removed");
}
