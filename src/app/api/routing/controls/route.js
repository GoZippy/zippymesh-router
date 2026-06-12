import { NextResponse } from "next/server";
import {
  getRoutingControls,
  updateRoutingControls
} from "@/lib/localDb.js";
import { checkAuth } from "@/lib/auth/middleware.js";
import { apiError } from "@/lib/apiErrors.js";

/**
 * GET /api/routing/controls
 * Get global routing control settings
 */
export async function GET(request) {
  try {
    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }

    const controls = await getRoutingControls();
    return NextResponse.json(controls);
  } catch (error) {
    console.error("Failed to get routing controls:", error);
    return apiError(request, 500, "Internal Server Error");
  }
}

/**
 * PATCH /api/routing/controls
 * Update global routing control settings
 */
export async function PATCH(request) {
  try {
    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }

    const data = await request.json();

    // Validate defaultAction if provided
    if (data.defaultAction && !["allow", "block"].includes(data.defaultAction)) {
      return apiError(request, 400, "Invalid defaultAction. Must be 'allow' or 'block'");
    }

    // Validate numeric fields if provided
    if (data.maxCostPer1k !== undefined && (typeof data.maxCostPer1k !== "number" || data.maxCostPer1k < 0)) {
      return apiError(request, 400, "Invalid maxCostPer1k. Must be a non-negative number");
    }

    if (data.maxLatencyMs !== undefined && (typeof data.maxLatencyMs !== "number" || data.maxLatencyMs < 0)) {
      return apiError(request, 400, "Invalid maxLatencyMs. Must be a non-negative number");
    }

    if (data.minTrustScore !== undefined) {
      if (typeof data.minTrustScore !== "number" || data.minTrustScore < 0 || data.minTrustScore > 100) {
        return apiError(request, 400, "Invalid minTrustScore. Must be a number between 0 and 100");
      }
    }

    // Validate array fields if provided
    const arrayFields = ["allowedCountries", "blockedCountries", "allowedIpRanges", "blockedIpRanges"];
    for (const field of arrayFields) {
      if (data[field] !== undefined && data[field] !== null) {
        if (!Array.isArray(data[field])) {
          return apiError(request, 400, `Invalid ${field}. Must be an array or null`);
        }
      }
    }

    const updated = await updateRoutingControls(data);
    if (!updated) {
      return apiError(request, 500, "Failed to update routing controls");
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update routing controls:", error);
    return apiError(request, 500, "Internal Server Error");
  }
}
