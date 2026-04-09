import { NextResponse } from "next/server";
import {
  getPendingSubmissions,
  createPendingSubmission,
  getCommunityActivityFeed,
} from "@/lib/localDb.js";
import { toCanonicalModel } from "@/lib/modelNormalization.js";

const MAX_USD_PER_M = 1000;

/**
 * GET /api/tokenbuddy/submissions
 * Returns pending submissions for community review
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    const providerId = searchParams.get("provider");
    const modelId = searchParams.get("model");
    const feed = searchParams.get("feed") === "true";
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    if (feed) {
      const activity = await getCommunityActivityFeed(limit);
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        activity,
      });
    }

    const filter = { status };
    if (providerId) filter.providerId = providerId;
    if (modelId) filter.modelId = modelId;

    const submissions = await getPendingSubmissions(filter);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      count: submissions.length,
      submissions: submissions.slice(0, limit),
    });
  } catch (error) {
    console.error("Error fetching submissions:", error);
    return NextResponse.json(
      { error: "Failed to fetch submissions" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tokenbuddy/submissions
 * Create a new pending submission
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

    if (!body.submittedBy) {
      return NextResponse.json(
        { error: "submittedBy (contributorId) is required" },
        { status: 400 }
      );
    }

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

    let canonicalModelId = body.canonicalModelId;
    if (!canonicalModelId) {
      try {
        const canonical = toCanonicalModel(body.providerId, body.modelId, null);
        canonicalModelId = canonical.canonicalModelId;
      } catch {
        canonicalModelId = body.modelId;
      }
    }

    const submission = await createPendingSubmission(
      {
        providerId: body.providerId,
        modelId: body.modelId,
        canonicalModelId,
        tier: body.tier || null,
        inputPerMUsd,
        outputPerMUsd,
        isFree: body.isFree || (inputPerMUsd === 0 && outputPerMUsd === 0),
        freeLimit: body.freeLimit || null,
        rateLimits: body.rateLimits || null,
        notes: body.notes || null,
        isNewModel: body.isNewModel || false,
        isUpdate: body.isUpdate || false,
        sourceUrl: body.sourceUrl || null,
      },
      body.submittedBy
    );

    return NextResponse.json({
      success: true,
      submission,
      message: submission.status === "verified"
        ? "Submission auto-verified (trusted contributor)"
        : "Submission created - awaiting community verification",
    });
  } catch (error) {
    console.error("Error creating submission:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create submission" },
      { status: 400 }
    );
  }
}
