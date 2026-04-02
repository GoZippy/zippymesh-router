import { errorResponse } from "open-sse/utils/error.js";
import { generateRequestId } from "@/lib/usageDb.js";
import { NextResponse } from "next/server";

export function getRequestIdFromRequest(request) {
  const fromHeader = request?.headers?.get?.("x-request-id");
  const normalized = typeof fromHeader === "string" ? fromHeader.trim() : "";
  return normalized ? normalized.slice(0, 128) : generateRequestId();
}

/**
 * Standardize generic error responses in Next.js routes
 */
export function apiError(request, statusCode, message, options = {}) {
  const requestId = options.requestId || getRequestIdFromRequest(request);
  return errorResponse(statusCode, message, { ...options, requestId });
}

/**
 * Wrap standard Next.js response to ensure correlation IDs are present
 */
export function withStandardHeaders(response, requestId) {
  if (!(response instanceof Response) && !(response instanceof NextResponse)) {
    return response;
  }
  
  if (requestId) {
    response.headers.set("X-Request-ID", requestId);
  }
  
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}

