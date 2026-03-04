import { NextResponse } from "next/server";
import {
  getRoutingControls,
  updateRoutingControls
} from "@/lib/localDb.js";
import { checkAuth } from "@/lib/auth/middleware.js";

/**
 * GET /api/routing/controls
 * Get global routing control settings
 */
export async function GET() {
  try {
    if (!(await checkAuth())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const controls = await getRoutingControls();
    return NextResponse.json(controls);
  } catch (error) {
    console.error("Failed to get routing controls:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/routing/controls
 * Update global routing control settings
 */
export async function PATCH(request) {
  try {
    if (!(await checkAuth())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await request.json();

    // Validate defaultAction if provided
    if (data.defaultAction && !["allow", "block"].includes(data.defaultAction)) {
      return NextResponse.json(
        { error: "Invalid defaultAction. Must be 'allow' or 'block'" },
        { status: 400 }
      );
    }

    // Validate numeric fields if provided
    if (data.maxCostPer1k !== undefined && (typeof data.maxCostPer1k !== "number" || data.maxCostPer1k < 0)) {
      return NextResponse.json(
        { error: "Invalid maxCostPer1k. Must be a non-negative number" },
        { status: 400 }
      );
    }

    if (data.maxLatencyMs !== undefined && (typeof data.maxLatencyMs !== "number" || data.maxLatencyMs < 0)) {
      return NextResponse.json(
        { error: "Invalid maxLatencyMs. Must be a non-negative number" },
        { status: 400 }
      );
    }

    if (data.minTrustScore !== undefined) {
      if (typeof data.minTrustScore !== "number" || data.minTrustScore < 0 || data.minTrustScore > 100) {
        return NextResponse.json(
          { error: "Invalid minTrustScore. Must be a number between 0 and 100" },
          { status: 400 }
        );
      }
    }

    // Validate array fields if provided
    const arrayFields = ["allowedCountries", "blockedCountries", "allowedIpRanges", "blockedIpRanges"];
    for (const field of arrayFields) {
      if (data[field] !== undefined && data[field] !== null) {
        if (!Array.isArray(data[field])) {
          return NextResponse.json(
            { error: `Invalid ${field}. Must be an array or null` },
            { status: 400 }
          );
        }
      }
    }

    const updated = await updateRoutingControls(data);
    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update routing controls" },
        { status: 500 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update routing controls:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
