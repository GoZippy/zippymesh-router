/**
 * JSON catch-all for the OpenAI-compatible surface.
 *
 * Added 2026-08-30. Anything under `/v1/*` (rewritten to `/api/v1/*` by
 * next.config.mjs) that has no route file used to fall through to Next's **HTML**
 * 404 page. An OpenAI SDK parses every response body as JSON, so an unknown path
 * — `/v1/embeddings` before it existed, `/v1/completions`, a typo — surfaced to
 * the caller as a parse error instead of an actionable
 * `{"error":{"message":...,"type":...,"code":...}}`. See
 * docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md §1.
 *
 * Static route segments take precedence over a catch-all in the App Router, so
 * every real endpoint under /api/v1 is unaffected; only genuinely unrouted paths
 * reach this file.
 */

import { errorResponse } from "open-sse/utils/error.js";
import { getRequestIdFromRequest } from "@/lib/apiErrors.js";

async function notFound(request, params) {
  const requestId = getRequestIdFromRequest(request);
  let suffix = "";
  try {
    const resolved = await params;
    const segments = resolved?.path;
    suffix = Array.isArray(segments) ? segments.join("/") : String(segments || "");
  } catch {
    suffix = "";
  }
  return errorResponse(
    404,
    `Unknown endpoint: /v1/${suffix}. This router implements /v1/chat/completions, /v1/embeddings, /v1/models, /v1/responses and /v1/messages.`,
    { requestId, code: "unknown_endpoint" }
  );
}

export async function GET(request, { params }) {
  return notFound(request, params);
}
export async function POST(request, { params }) {
  return notFound(request, params);
}
export async function PUT(request, { params }) {
  return notFound(request, params);
}
export async function PATCH(request, { params }) {
  return notFound(request, params);
}
export async function DELETE(request, { params }) {
  return notFound(request, params);
}
export async function HEAD(request, { params }) {
  const res = await notFound(request, params);
  return new Response(null, { status: res.status, headers: res.headers });
}
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
