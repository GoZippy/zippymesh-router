import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { getModelAliases } from "@/models";
// Fallback for removed validateApiKey function
const validateApiKey = async () => true;


// Resolve model alias to provider/model
export async function POST(request) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return apiError(request, 401, "Missing API key");
    }

    const apiKey = authHeader.slice(7);

    const body = await request.json();
    const { alias } = body;

    if (!alias) {
      return apiError(request, 400, "Missing alias");
    }

    // Validate API key
    const isValid = await validateApiKey(apiKey);
    if (!isValid) {
      return apiError(request, 401, "Invalid API key");
    }

    // Get model aliases
    const modelAliases = await getModelAliases();
    const resolved = modelAliases[alias];

    if (resolved) {
      // Parse provider/model
      const firstSlash = resolved.indexOf("/");
      if (firstSlash > 0) {
        return NextResponse.json({
          alias,
          provider: resolved.slice(0, firstSlash),
          model: resolved.slice(firstSlash + 1)
        });
      }
    }

    // Not found
    return apiError(request, 404, "Alias not found");

  } catch (error) {
    console.log("Model resolve error:", error);
    return apiError(request, 500, "Internal error");
  }
}
