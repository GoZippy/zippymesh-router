/**
 * POST /api/discovery/recommend
 *
 * Returns model recommendations for a specific task with optional constraints.
 * Use this endpoint from tools and agents to get smart model suggestions.
 *
 * Request Body:
 * {
 *   "intent": "code|chat|reasoning|vision|embedding|fast|default",
 *   "context": "Optional description of the task (e.g., 'fixing a bug in React')",
 *   "constraints": {
 *     "maxLatencyMs": 3000,
 *     "maxCostPerMTokens": 0.001,
 *     "minContextWindow": 8000,
 *     "preferFree": false,
 *     "preferLocal": false
 *   }
 * }
 *
 * Response includes:
 * - recommendations: Ordered list of top 3 models
 * - fallbackChain: Pre-configured failover models
 * - constraints: Validated constraints
 * - summary: Human-readable explanation
 */

import { NextResponse } from "next/server";
import {
  getRecommendations,
  getModelsByCapability,
  validateModel,
} from "@/lib/discovery/recommendationService.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function POST(request) {
  try {
    const body = await request.json();

    // Validate required fields
    const intent = body.intent || "default";
    const context = body.context || "";
    const constraints = body.constraints || {};

    // Validate intent
    const validIntents = [
      "code",
      "chat",
      "reasoning",
      "vision",
      "embedding",
      "fast",
      "default",
    ];
    if (!validIntents.includes(intent)) {
      return NextResponse.json(
        {
          error: "Invalid intent",
          validIntents,
          received: intent,
        },
        { status: 400 }
      );
    }

    // Normalize constraints
    const normalizedConstraints = {
      maxLatencyMs: constraints.maxLatencyMs
        ? Math.max(500, constraints.maxLatencyMs)
        : undefined,
      maxCostPerMTokens: constraints.maxCostPerMTokens
        ? Math.max(0, constraints.maxCostPerMTokens)
        : undefined,
      minContextWindow: constraints.minContextWindow
        ? Math.max(1000, constraints.minContextWindow)
        : undefined,
      preferFree: Boolean(constraints.preferFree),
      preferLocal: Boolean(constraints.preferLocal),
    };

    // Get recommendations
    const recommendations = await getRecommendations(
      intent,
      normalizedConstraints,
      context
    );

    return NextResponse.json(recommendations);
  } catch (error) {
    console.error("Error getting recommendations:", error);
    return NextResponse.json(
      {
        error: "Failed to get recommendations",
        message: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/discovery/recommend?capability=code
 * Get models by capability (for simpler use cases)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const capability = searchParams.get("capability");
    if (!capability) {
      return NextResponse.json(
        {
          error: "Missing query parameter: capability",
          example: "/api/discovery/recommend?capability=code",
        },
        { status: 400 }
      );
    }

    const result = await getModelsByCapability(capability);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error getting models by capability:", error);
    return NextResponse.json(
      {
        error: "Failed to get models",
        message: error.message,
      },
      { status: 500 }
    );
  }
}
