import { PROVIDER_MODELS } from "@/shared/constants/models";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET(request) {
  // optional auth
  const { getSettings } = await import("@/lib/localDb.js");
  const settings = await getSettings();
  if (settings.requireApiKey) {
    const { requireApiKey } = await import("@/lib/auth/apiKey.js");
    try {
      await requireApiKey(request);
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: err.code || 401, headers: { "Content-Type": "application/json" } });
    }
  }

  try {
    // Collect all models from all providers
    const models = [];
    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS || {})) {
      if (!Array.isArray(providerModels)) continue;
      for (const model of providerModels) {
        models.push({
          name: `models/${provider}/${model.id}`,
          displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
          supportedGenerationMethods: ["generateContent"],
          inputTokenLimit: 128000,
          outputTokenLimit: 8192,
        });
      }
    }

    return Response.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json({ error: { message: error.message } }, { status: 500 });
  }
}

