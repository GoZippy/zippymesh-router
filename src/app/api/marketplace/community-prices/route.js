import { NextResponse } from "next/server";
import {
  getCommunityPriceSubmissions,
  submitCommunityPrice,
  recordContribution,
} from "@/lib/localDb.js";
import { toCanonicalModel } from "@/lib/modelNormalization.js";

/** Max sane price: $1000 per 1M tokens */
const MAX_USD_PER_M = 1000;

/**
 * GET /api/marketplace/community-prices
 * Returns community-submitted price data
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("provider");
    const modelId = searchParams.get("model");
    const source = searchParams.get("source");
    const validated = searchParams.get("validated");
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    const filter = {};
    if (providerId) filter.providerId = providerId;
    if (modelId) filter.modelId = modelId;
    if (source) filter.source = source;
    if (validated !== null) filter.validated = validated === "true";

    const submissions = await getCommunityPriceSubmissions(filter);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      count: submissions.length,
      submissions: submissions.slice(0, limit),
    });
  } catch (error) {
    console.error("Error fetching community prices:", error);
    return NextResponse.json(
      { error: "Failed to fetch community prices" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/marketplace/community-prices
 * Submit a new community price report
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

    // Validate pricing values
    const inputPerMUsd = Number(body.inputPerMUsd);
    const outputPerMUsd = Number(body.outputPerMUsd);

    if (!Number.isFinite(inputPerMUsd) || inputPerMUsd < 0 || inputPerMUsd > MAX_USD_PER_M) {
      return NextResponse.json(
        { error: `inputPerMUsd must be between 0 and ${MAX_USD_PER_M}` },
        { status: 400 }
      );
    }

    if (!Number.isFinite(outputPerMUsd) || outputPerMUsd < 0 || outputPerMUsd > MAX_USD_PER_M) {
      return NextResponse.json(
        { error: `outputPerMUsd must be between 0 and ${MAX_USD_PER_M}` },
        { status: 400 }
      );
    }

    // Derive canonical model ID if not provided
    let canonicalModelId = body.canonicalModelId;
    if (!canonicalModelId) {
      try {
        const canonical = toCanonicalModel(body.providerId, body.modelId, null);
        canonicalModelId = canonical.canonicalModelId;
      } catch {
        canonicalModelId = body.modelId;
      }
    }

    const contributorId = body.submittedBy || "anonymous";
    const isFree = body.isFree || (inputPerMUsd === 0 && outputPerMUsd === 0);

    const submission = await submitCommunityPrice({
      providerId: body.providerId,
      modelId: body.modelId,
      canonicalModelId,
      tier: body.tier || null,
      inputPerMUsd,
      outputPerMUsd,
      source: body.source || "user_submitted",
      submittedBy: contributorId,
      sampleSize: body.sampleSize || null,
      notes: body.notes || null,
      isFree,
      freeLimit: body.freeLimit || null,
    });

    // Award TokenBuddy points
    let contributionType = "PRICE_SUBMISSION";
    if (body.isVerification) contributionType = "PRICE_VERIFICATION";
    else if (body.isNewModel) contributionType = "NEW_MODEL_ADDED";
    else if (body.isUpdate) contributionType = "PRICE_UPDATE";
    else if (isFree) contributionType = "FREE_MODEL_REPORTED";

    let contributorResult = null;
    if (contributorId !== "anonymous") {
      try {
        contributorResult = await recordContribution(contributorId, contributionType, {
          providerId: body.providerId,
          modelId: body.modelId,
        });
      } catch (err) {
        console.warn("Failed to record contribution:", err);
      }
    }

    return NextResponse.json({
      success: true,
      submission,
      contribution: contributorResult ? {
        pointsEarned: contributorResult.contributor.totalPoints,
        newBadges: contributorResult.newBadges,
      } : null,
    });
  } catch (error) {
    console.error("Error submitting community price:", error);
    return NextResponse.json(
      { error: "Failed to submit community price" },
      { status: 500 }
    );
  }
}
