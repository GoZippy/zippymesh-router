import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import {
  getContributorLeaderboard,
  getContributor,
  dailyCheckin,
} from "@/lib/localDb.js";

/**
 * GET /api/tokenbuddy/contributors
 * Returns contributor leaderboards
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "total";
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const contributorId = searchParams.get("id");

    // If specific contributor requested
    if (contributorId) {
      const contributor = await getContributor(contributorId);
      return NextResponse.json({ contributor });
    }

    // Get leaderboard
    const leaderboard = await getContributorLeaderboard(type, limit);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      type,
      leaderboard,
    });
  } catch (error) {
    console.error("Error fetching contributors:", error);
    return apiError(request, 500, "Failed to fetch contributors");
  }
}

/**
 * POST /api/tokenbuddy/contributors
 * Daily check-in or update display name
 */
export async function POST(request) {
  try {
    const body = await request.json();

    if (body.action === "checkin") {
      if (!body.contributorId) {
        return apiError(request, 400, "contributorId is required");
      }

      const result = await dailyCheckin(body.contributorId);
      return NextResponse.json(result);
    }

    if (body.action === "updateDisplayName") {
      if (!body.contributorId || !body.displayName) {
        return apiError(request, 400, "contributorId and displayName are required");
      }

      const contributor = await getContributor(body.contributorId);
      contributor.displayName = body.displayName.slice(0, 30);
      
      return NextResponse.json({
        success: true,
        contributor,
      });
    }

    return apiError(request, 400, "Invalid action");
  } catch (error) {
    console.error("Error updating contributor:", error);
    return apiError(request, 500, "Failed to update contributor");
  }
}
