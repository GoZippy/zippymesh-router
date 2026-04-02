/**
 * GET /api/discovery/catalog
 *
 * Returns comprehensive model and playbook catalog for tool integration.
 * This endpoint provides a unified view of all available models across
 * cloud providers, local deployments, p2p networks, and playbooks.
 *
 * Query Parameters:
 *   - detailed=true/false: Include full model metadata (default: true)
 *   - filter=code|vision|fast|reasoning: Filter by capability
 *   - source=cloud|local|p2p: Filter by model source
 *   - intent=code|chat|...: Filter playbooks by intent
 */

import { NextResponse } from "next/server";
import { getDiscoveryCatalog } from "@/lib/discovery/catalogService.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const detailed = searchParams.get("detailed") !== "false";
    const capabilityFilter = searchParams.get("filter");
    const sourceFilter = searchParams.get("source");
    const intentFilter = searchParams.get("intent");

    // Get full catalog
    const catalog = await getDiscoveryCatalog();

    // Apply filters
    let models = catalog.models;

    if (capabilityFilter) {
      models = models.filter(m =>
        m.capabilities.includes(capabilityFilter.toLowerCase())
      );
    }

    if (sourceFilter) {
      models = models.filter(m => m.source === sourceFilter);
    }

    // Build response based on detail level
    const responseModels = detailed
      ? models
      : models.map(m => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          capabilities: m.capabilities,
          isFree: m.isFree,
        }));

    // Filter playbooks if requested
    let playbooks = catalog.playbooks;
    if (intentFilter) {
      playbooks = playbooks.filter(pb =>
        pb.intents.includes(intentFilter.toLowerCase())
      );
    }

    const response = {
      generatedAt: catalog.generatedAt,
      version: catalog.version,

      server: catalog.server,

      summary: {
        ...catalog.summary,
        filteredModels: responseModels.length,
        filteredPlaybooks: playbooks.length,
      },

      intents: catalog.intents,

      models: responseModels,
      playbooks: detailed ? playbooks : playbooks.map(p => ({
        id: p.id,
        name: p.name,
        intents: p.intents,
      })),

      // Include indices only if detailed
      ...(detailed && {
        indices: {
          byCapability: buildCapabilityIndex(responseModels),
          byProvider: buildProviderIndex(responseModels),
        },
      }),

      // Help text for integration
      _links: {
        recommend: "/api/discovery/recommend",
        validate: "/api/discovery/validate",
        models: "/v1/models",
      },

      _hints: {
        usage: "Pass fullModel or id to /v1/chat/completions",
        capabilities: "Filter models by: " + Object.keys(catalog.indices.byCapability).join(", "),
        intents: "Recommended intents: " + Object.keys(catalog.intents).join(", "),
        filtering: "Use ?filter=code&source=local for advanced queries",
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching catalog:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch catalog",
        message: error.message,
      },
      { status: 500 }
    );
  }
}

function buildCapabilityIndex(models) {
  const index = {};
  for (const model of models) {
    for (const cap of model.capabilities) {
      if (!index[cap]) index[cap] = [];
      index[cap].push(model.id);
    }
  }
  return index;
}

function buildProviderIndex(models) {
  const index = {};
  for (const model of models) {
    if (!index[model.provider]) index[model.provider] = [];
    index[model.provider].push(model.id);
  }
  return index;
}
