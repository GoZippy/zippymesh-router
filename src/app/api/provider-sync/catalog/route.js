import { NextResponse } from "next/server";
import { getProviderCatalog } from "@/lib/providers/catalog.js";
import { PROVIDERS as RUNTIME_PROVIDER_CONFIG } from "../../../../../open-sse/config/constants.js";
import { apiError } from "@/lib/apiErrors.js";

function getRuntimeEndpointMap() {
  const map = {};
  for (const [providerId, config] of Object.entries(RUNTIME_PROVIDER_CONFIG || {})) {
    map[providerId] = {
      baseUrl: config.baseUrl || null,
      baseUrls: Array.isArray(config.baseUrls) ? config.baseUrls : undefined,
      format: config.format || "openai",
    };
  }
  return map;
}

export async function GET(request) {
  try {
    const catalog = getProviderCatalog();
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      summary: catalog.summary,
      providers: catalog.providers,
      runtimeEndpoints: getRuntimeEndpointMap(),
    });
  } catch (error) {
    console.error("Error building provider catalog:", error);
    return apiError(request, 500, "Failed to build provider catalog");
  }
}

