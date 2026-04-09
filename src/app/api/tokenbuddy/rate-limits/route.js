import { NextResponse } from "next/server";
import { getRateLimits, reportRateLimit, getAllRateLimits } from "@/lib/localDb.js";

/**
 * GET /api/tokenbuddy/rate-limits
 * Get rate limits for a provider/model
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("provider");
    const modelId = searchParams.get("model");
    const all = searchParams.get("all") === "true";

    if (all) {
      const grouped = await getAllRateLimits();
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        rateLimits: grouped,
      });
    }

    if (!providerId) {
      return NextResponse.json(
        { error: "provider parameter is required (or use all=true)" },
        { status: 400 }
      );
    }

    const limits = await getRateLimits(providerId, modelId);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      providerId,
      modelId,
      count: limits.length,
      rateLimits: limits,
    });
  } catch (error) {
    console.error("Error fetching rate limits:", error);
    return NextResponse.json(
      { error: "Failed to fetch rate limits" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tokenbuddy/rate-limits
 * Report rate limits for a provider/model
 */
export async function POST(request) {
  try {
    const body = await request.json();

    if (!body.providerId || !body.modelId) {
      return NextResponse.json(
        { error: "providerId and modelId are required" },
        { status: 400 }
      );
    }

    if (!body.reportedBy) {
      return NextResponse.json(
        { error: "reportedBy (contributorId) is required" },
        { status: 400 }
      );
    }

    // Validate at least one limit is provided
    const hasLimits = body.requestsPerMinute || body.requestsPerDay ||
                      body.tokensPerMinute || body.tokensPerDay ||
                      body.contextWindow || body.maxOutputTokens;

    if (!hasLimits) {
      return NextResponse.json(
        { error: "At least one rate limit value is required" },
        { status: 400 }
      );
    }

    const report = await reportRateLimit(
      {
        providerId: body.providerId,
        modelId: body.modelId,
        tier: body.tier,
        requestsPerMinute: body.requestsPerMinute,
        requestsPerDay: body.requestsPerDay,
        tokensPerMinute: body.tokensPerMinute,
        tokensPerDay: body.tokensPerDay,
        contextWindow: body.contextWindow,
        maxOutputTokens: body.maxOutputTokens,
        notes: body.notes,
        sourceUrl: body.sourceUrl,
      },
      body.reportedBy
    );

    return NextResponse.json({
      success: true,
      report,
    });
  } catch (error) {
    console.error("Error reporting rate limit:", error);
    return NextResponse.json(
      { error: error.message || "Failed to report rate limit" },
      { status: 400 }
    );
  }
}
