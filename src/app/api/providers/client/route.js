import { errorResponse } from "open-sse/utils/error.js";
import { generateRequestId } from "@/lib/usageDb.js";

/**
 * GET /api/providers/client
 * Removed — previously returned all provider connections including sensitive
 * fields (API keys, tokens) without authentication for cloud sync.
 */
export async function GET() {
  return errorResponse(410, "Endpoint removed", { requestId: generateRequestId() });
}
