import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getProviderConnections, getCombos, getDb } from "@/lib/localDb";
import { getSidecarPeers } from "@/lib/sidecar";

/**
 * Handle CORS preflight
 * ... (unchanged)
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/models - OpenAI compatible models list
 * Returns models from all active providers and combos in OpenAI format
 */
export async function GET() {
  try {
    // Get active provider connections
    let connections = [];
    try {
      connections = await getProviderConnections();
      // Filter to only active connections
      connections = connections.filter(c => c.isActive !== false);
    } catch (e) {
      console.log("Could not fetch providers, returning all models");
    }

    // Get combos
    let combos = [];
    try {
      combos = await getCombos();
    } catch (e) {
      console.log("Could not fetch combos");
    }

    // Get P2P Peers
    let p2pPeers = [];
    try {
      p2pPeers = await getSidecarPeers();
    } catch (e) {
      console.log("Could not fetch sidecar peers");
    }

    // Build set of active provider aliases
    const activeAliases = new Set();
    for (const conn of connections) {
      const alias = PROVIDER_ID_TO_ALIAS[conn.provider] || conn.provider;
      activeAliases.add(alias);
    }

    // Collect models from active providers (or all if none active)
    const models = [];
    const timestamp = Math.floor(Date.now() / 1000);

    // Add combos first (they appear at the top)
    for (const combo of combos) {
      models.push({
        id: combo.name,
        object: "model",
        created: timestamp,
        owned_by: "combo",
        permission: [],
        root: combo.name,
        parent: null,
      });
    }

    // Add P2P Models
    const p2pModels = new Set();
    for (const peer of p2pPeers) {
      if (peer.models) {
        for (const model of peer.models) {
          // Avoid duplicates if multiple peers offer same model
          const modelId = `p2p/${model.name}`;
          if (!p2pModels.has(modelId)) {
            p2pModels.add(modelId);
            models.push({
              id: modelId,
              object: "model",
              created: timestamp,
              owned_by: "p2p",
              permission: [],
              root: model.name,
              parent: null,
              meta: {
                cost: model.cost_per_token,
                quantization: model.quantization
              }
            });
          }
        }
      }
    }

    // Add cached Kilo models
    const db = await getDb();
    const cached = db.data.cachedModels?.kilo || {};
    for (const [baseUrl, entry] of Object.entries(cached)) {
      for (const m of entry.list || []) {
        if (!m?.id) continue;
        const id = `kilo/${m.id}`;
        models.push({
          id,
          object: "model",
          created: timestamp,
          owned_by: "kilo",
          permission: [],
          root: m.id,
          parent: null,
          zippy: { source: "kilo-cache", baseUrl, fetchedAt: entry.fetchedAt, raw: m },
        });
      }
    }

    // Add provider models
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      // If we have active providers, only include those; otherwise include all
      if (connections.length > 0 && !activeAliases.has(alias)) {
        continue;
      }

      for (const model of providerModels) {
        models.push({
          id: `${alias}/${model.id}`,
          object: "model",
          created: timestamp,
          owned_by: alias,
          permission: [],
          root: model.id,
          parent: null,
        });
      }
    }

    return Response.json({
      object: "list",
      data: models,
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}
