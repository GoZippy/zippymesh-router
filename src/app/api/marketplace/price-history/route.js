import { NextResponse } from "next/server";
import { getPriceHistory, recordPriceHistory, getFreeModels } from "@/lib/localDb.js";

/**
 * GET /api/marketplace/price-history
 * Returns price history for tracking price changes over time
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("provider");
    const modelId = searchParams.get("model");
    const activeOnly = searchParams.get("active") === "true";
    const freeOnly = searchParams.get("free") === "true";

    let history;
    if (freeOnly) {
      history = await getFreeModels();
    } else if (providerId) {
      history = await getPriceHistory(providerId, modelId, activeOnly);
    } else {
      // Return all history if no provider specified
      history = await getPriceHistory("*", null, activeOnly);
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      count: history.length,
      history,
    });
  } catch (error) {
    console.error("Error fetching price history:", error);
    return NextResponse.json(
      { error: "Failed to fetch price history" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/marketplace/price-history
 * Record a price change (for tracking historical data)
 */
export async function POST(request) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.providerId || !body.modelId) {
      return NextResponse.json(
        { error: "providerId and modelId are required" },
        { status: 400 }
      );
    }

    const record = await recordPriceHistory({
      providerId: body.providerId,
      modelId: body.modelId,
      tier: body.tier || null,
      inputPerMUsd: body.inputPerMUsd,
      outputPerMUsd: body.outputPerMUsd,
      isFree: body.isFree || false,
      freeLimit: body.freeLimit || null,
      freeExpiresAt: body.freeExpiresAt || null,
      source: body.source || "official",
    });

    return NextResponse.json({
      success: true,
      record,
    });
  } catch (error) {
    console.error("Error recording price history:", error);
    return NextResponse.json(
      { error: "Failed to record price history" },
      { status: 500 }
    );
  }
}
