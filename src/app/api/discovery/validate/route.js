/**
 * POST /api/discovery/validate
 *
 * Validates if a specific model can handle a request with given requirements.
 * Use this before committing to a model in your tool.
 *
 * Request Body:
 * {
 *   "modelId": "claude-opus-4.6",
 *   "intent": "code",
 *   "requirements": {
 *     "requiredCapabilities": ["code"],
 *     "contextWindow": 8000,
 *     "maxCost": 0.001
 *   }
 * }
 *
 * Response:
 * {
 *   "valid": true|false,
 *   "model": "...",
 *   "reason": "...",
 *   "issues": [...],
 *   "suggestions": ["alternative-model-1", "alternative-model-2"]
 * }
 */

import { NextResponse } from "next/server";
import { validateModel } from "@/lib/discovery/recommendationService.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function POST(request) {
  try {
    const body = await request.json();

    const { modelId, intent = "default", requirements = {} } = body;

    if (!modelId) {
      return NextResponse.json(
        { error: "modelId is required" },
        { status: 400 }
      );
    }

    const result = await validateModel(modelId, intent, requirements);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error validating model:", error);
    return NextResponse.json(
      {
        error: "Failed to validate model",
        message: error.message,
      },
      { status: 500 }
    );
  }
}
