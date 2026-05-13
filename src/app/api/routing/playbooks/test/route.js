import { NextResponse } from "next/server";
import { smartRouter } from "@/lib/routing/smartRouter.js";
import { getRecommendations } from "@/lib/discovery/recommendationService.js";
import { getDiscoveryCatalog } from "@/lib/discovery/catalogService.js";

/**
 * POST /api/routing/playbooks/test
 * Dry-run routing simulation — returns which model would be selected
 * without actually executing the request.
 *
 * Body:
 * {
 *   messages: [{ role: "user", content: "..." }],
 *   model: "auto" | "specific-model-id",
 *   intent?: "code" | "reasoning" | "vision" | "embedding" | "fast" | "default",
 *   constraints?: {
 *     maxLatencyMs?: number,
 *     maxCostPerMTokens?: number,
 *     minContextWindow?: number,
 *     preferFree?: boolean,
 *     preferLocal?: boolean
 *   }
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   selected: string,
 *   intent: string,
 *   score: number,
 *   reason: string,
 *   fallbackChain: string[],
 *   alternatives: string[],
 *   breakdown: { model, score, reasons[] }[]
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { messages, model, intent: explicitIntent, constraints } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "messages array is required" }, { status: 400 });
    }

    // Build a mock request object that smartRouter can process
    const headerMap = new Map();
    if (explicitIntent) headerMap.set("x-intent", explicitIntent);
    if (constraints?.maxLatencyMs) headerMap.set("x-max-latency-ms", String(constraints.maxLatencyMs));
    if (constraints?.maxCostPerMTokens) headerMap.set("x-max-cost-per-m-tokens", String(constraints.maxCostPerMTokens));
    if (constraints?.minContextWindow) headerMap.set("x-min-context-window", String(constraints.minContextWindow));
    if (constraints?.preferFree) headerMap.set("x-prefer-free", "true");
    if (constraints?.preferLocal) headerMap.set("x-prefer-local", "true");

    const mockRequest = {
      headers: { get: (k) => headerMap.get(k.toLowerCase()) ?? null },
      body: { model: model || "auto", messages },
    };

    const routing = await smartRouter(mockRequest);

    if (!routing.success) {
      return NextResponse.json({
        success: false,
        error: routing.error || "Routing simulation failed",
        selected: "default",
        fallbackChain: ["default"],
      });
    }

    // Get full recommendation breakdown for the scoring detail
    let breakdown = [];
    try {
      const catalog = await getDiscoveryCatalog();
      const intent = routing.intent || "default";
      const recs = await getRecommendations(intent, constraints || null, "");
      breakdown = (recs.recommendations || []).slice(0, 5).map(r => ({
        model: r.fullModel,
        score: r.score,
        reasons: r.reasoning || [],
        isFree: r.isFree,
        provider: r.provider,
      }));
    } catch (e) {
      // Non-fatal — breakdown is bonus info
    }

    return NextResponse.json({
      success: true,
      selected: routing.selected,
      intent: routing.intent,
      score: routing.score,
      reason: routing.reason,
      fallbackChain: routing.fallbackChain || [routing.selected],
      alternatives: routing.alternatives || [],
      constraints: routing.constraints || null,
      breakdown,
      simulatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[PlaybookTest] Error:", error);
    return NextResponse.json(
      { error: "Simulation failed", details: error.message },
      { status: 500 }
    );
  }
}
