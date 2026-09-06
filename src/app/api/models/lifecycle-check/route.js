import { NextResponse } from "next/server";
import { getRegistryModel } from "@/lib/modelRegistry";
import { apiError } from "@/lib/apiErrors.js";

const MAX_PAIRS = 200;

/**
 * POST /api/models/lifecycle-check
 * Body: { pairs: ["providerId/modelId", ...] }
 * Returns: { results: { "providerId/modelId": { lifecycleState, missingSinceAt } | null } }
 *
 * Lets the UI flag saved references (combos, playbooks) to a provider/model
 * pair that has since gone `missing` or `deprecated` in the model registry.
 * `/api/models/available` can't answer this — it only returns `active` rows,
 * so a stale reference silently disappears from that list instead of
 * surfacing as a warning where the reference is actually used.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const pairs = Array.isArray(body?.pairs) ? body.pairs : [];

    if (pairs.length === 0) {
      return NextResponse.json({ results: {} });
    }
    if (pairs.length > MAX_PAIRS) {
      return apiError(request, 400, `Too many pairs (max ${MAX_PAIRS})`);
    }

    const results = {};
    for (const raw of pairs) {
      const pair = typeof raw === "string" ? raw.trim() : "";
      if (!pair || pair in results) continue;

      const slashIndex = pair.indexOf("/");
      if (slashIndex <= 0 || slashIndex === pair.length - 1) {
        results[pair] = null;
        continue;
      }
      const provider = pair.slice(0, slashIndex);
      const modelId = pair.slice(slashIndex + 1);

      const registryModel = await getRegistryModel(provider, modelId);
      results[pair] = registryModel
        ? {
            lifecycleState: registryModel.lifecycleState,
            missingSinceAt: registryModel.missingSinceAt || null,
          }
        : null;
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.log("Error checking model lifecycle:", error);
    return apiError(request, 500, "Failed to check model lifecycle");
  }
}
