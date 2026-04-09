import { NextResponse } from "next/server";
import { getPreviewModels, reportPreviewModel } from "@/lib/localDb.js";

/**
 * GET /api/tokenbuddy/preview-models
 * Get active preview/codename models
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("provider");
    const isFree = searchParams.get("free");

    const filter = { status: "active" };
    if (providerId) filter.providerId = providerId;
    if (isFree !== null) filter.isFree = isFree === "true";

    const models = await getPreviewModels(filter);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      count: models.length,
      models,
    });
  } catch (error) {
    console.error("Error fetching preview models:", error);
    return NextResponse.json(
      { error: "Failed to fetch preview models" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tokenbuddy/preview-models
 * Report a new preview/codename model
 */
export async function POST(request) {
  try {
    const body = await request.json();

    if (!body.providerId || !body.codename) {
      return NextResponse.json(
        { error: "providerId and codename are required" },
        { status: 400 }
      );
    }

    if (!body.reportedBy) {
      return NextResponse.json(
        { error: "reportedBy (contributorId) is required" },
        { status: 400 }
      );
    }

    const model = await reportPreviewModel(
      {
        providerId: body.providerId,
        codename: body.codename,
        displayName: body.displayName,
        description: body.description,
        isFree: body.isFree || false,
        limitations: body.limitations || [],
        expirationDate: body.expirationDate,
        linkedOfficialModel: body.linkedOfficialModel,
      },
      body.reportedBy
    );

    return NextResponse.json({
      success: true,
      model,
    });
  } catch (error) {
    console.error("Error reporting preview model:", error);
    return NextResponse.json(
      { error: error.message || "Failed to report preview model" },
      { status: 400 }
    );
  }
}
