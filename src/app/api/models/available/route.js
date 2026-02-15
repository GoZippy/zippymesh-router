import { NextResponse } from "next/server";
import { getProviderConnections, getModelAliases } from "@/models";
import { getCombos } from "@/lib/localDb.js";
import { SOTA_EQUIVALENCE } from "@/sse/config/modelEquivalence.js";

/**
 * GET /api/models/available
 * Returns all available models from active providers + equivalence groups + combos
 * OpenClaw can use this to dynamically sync available models
 */
export async function GET() {
  try {
    const connections = await getProviderConnections();
    const aliases = await getModelAliases();
    const combos = await getCombos();

    // Build available models from active connections
    const availableModels = new Set();

    connections
      .filter(c => c.testStatus === "active" || c.testStatus !== "error")
      .forEach(connection => {
        // Add provider's supported models if defined
        if (connection.supportedModels && Array.isArray(connection.supportedModels)) {
          connection.supportedModels.forEach(model => {
            availableModels.add(model);
          });
        }
        // For providers that don't explicitly list models, add provider-specific defaults
        if (connection.provider === "claude" || connection.provider === "anthropic") {
          ["claude-3-5-sonnet", "claude-3-opus", "claude-3-haiku"].forEach(m => {
            availableModels.add(m);
          });
        }
        if (connection.provider === "openai") {
          ["gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"].forEach(m => {
            availableModels.add(m);
          });
        }
        if (connection.provider === "gemini") {
          ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2-flash"].forEach(m => {
            availableModels.add(m);
          });
        }
      });

    // Add combo models
    combos.forEach(combo => {
      if (combo.name) {
        availableModels.add(combo.name);
      }
    });

    // Build equivalence groups (which models are considered equivalent)
    const equivalenceGroups = SOTA_EQUIVALENCE || {};

    return NextResponse.json({
      availableModels: Array.from(availableModels).sort(),
      equivalenceGroups,
      combos: combos.map(c => ({
        name: c.name,
        models: c.models,
        description: c.description || "Fallback combo",
        fallbackChain: true
      })),
      totalProviders: connections.length,
      activeProviders: connections.filter(c => c.testStatus === "active").length,
      aliases,
      lastUpdated: new Date().toISOString(),
      cacheControlHint: "Can be cached for 5 minutes"
    });
  } catch (error) {
    console.error("[models/available] Error:", error.message);
    return NextResponse.json(
      {
        error: "Failed to fetch available models",
        message: error.message
      },
      { status: 500 }
    );
  }
}
