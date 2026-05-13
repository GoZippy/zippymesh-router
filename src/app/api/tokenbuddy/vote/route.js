import { NextResponse } from "next/server";
import { voteOnSubmission, getContributorTrustInfo } from "@/lib/localDb.js";

/**
 * POST /api/tokenbuddy/vote
 * Vote on a pending submission
 */
export async function POST(request) {
  try {
    const body = await request.json();

    if (!body.submissionId) {
      return NextResponse.json(
        { error: "submissionId is required" },
        { status: 400 }
      );
    }

    if (!body.voterId) {
      return NextResponse.json(
        { error: "voterId (contributorId) is required" },
        { status: 400 }
      );
    }

    if (!body.vote || !["up", "down"].includes(body.vote)) {
      return NextResponse.json(
        { error: "vote must be 'up' or 'down'" },
        { status: 400 }
      );
    }

    const { submission, result } = await voteOnSubmission(
      body.submissionId,
      body.voterId,
      body.vote,
      body.reason || null
    );

    return NextResponse.json({
      success: true,
      submission,
      result,
    });
  } catch (error) {
    console.error("Error voting:", error);
    return NextResponse.json(
      { error: error.message || "Failed to vote" },
      { status: 400 }
    );
  }
}

/**
 * GET /api/tokenbuddy/vote?contributorId=xxx
 * Get voting eligibility and trust info
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const contributorId = searchParams.get("contributorId");

    if (!contributorId) {
      return NextResponse.json(
        { error: "contributorId is required" },
        { status: 400 }
      );
    }

    const trustInfo = await getContributorTrustInfo(contributorId);

    return NextResponse.json({
      contributorId,
      ...trustInfo,
    });
  } catch (error) {
    console.error("Error getting trust info:", error);
    return NextResponse.json(
      { error: "Failed to get trust info" },
      { status: 500 }
    );
  }
}
