import { NextResponse } from "next/server";
import { getRecentProviderLifecycleEvents } from "@/lib/lifecycleEvents.js";
import { apiError, withStandardHeaders, getRequestIdFromRequest } from "@/lib/apiErrors.js";

export async function GET(request) {
  const requestId = getRequestIdFromRequest(request);
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    
    const events = await getRecentProviderLifecycleEvents(limit);
    
    return withStandardHeaders(NextResponse.json({
      events,
      count: events.length,
      requestId
    }), requestId);
  } catch (error) {
    console.error("Error fetching provider events:", error);
    return apiError(request, 500, "Failed to fetch provider events", { requestId });
  }
}
