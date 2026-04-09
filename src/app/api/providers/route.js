import { NextResponse } from "next/server";
import { getProviderConnections, createProviderConnection, getProviderNodeById, getProviderNodes } from "@/models";
// Fallback for removed isCloudEnabled function
const isCloudEnabled = async () => false;

import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  LOCAL_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
} from "@/shared/constants/providers";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { toSafeProviderConnection } from "@/shared/utils/providerSecurity";
import { syncToCloud } from "@/lib/syncCloud";
import { syncProviderCatalog } from "@/lib/providers/sync";
import { apiError, withStandardHeaders, getRequestIdFromRequest } from "@/lib/apiErrors";

// GET /api/providers - List all connections
export async function GET(request) {
  const requestId = getRequestIdFromRequest(request);
  try {
    const connections = await getProviderConnections();

    // Hide sensitive fields and expose status flags safe for UI.
    const safeConnections = connections.map(toSafeProviderConnection);

    return withStandardHeaders(NextResponse.json({ connections: safeConnections }), requestId);
  } catch (error) {
    console.log("Error fetching providers:", error);
    return apiError(request, 500, "Failed to fetch providers");
  }
}

// POST /api/providers - Create new connection (API Key only, OAuth via separate flow)
export async function POST(request) {
  const requestId = getRequestIdFromRequest(request);
  try {
    const body = await request.json();
    const { provider, apiKey, name, priority, globalPriority, defaultModel, testStatus } = body;

    // Validation
    const isValidProvider = APIKEY_PROVIDERS[provider] ||
      LOCAL_PROVIDERS[provider] ||
      isOpenAICompatibleProvider(provider) ||
      isAnthropicCompatibleProvider(provider);

    if (!provider || !isValidProvider) {
      return apiError(request, 400, "Invalid provider", { requestId });
    }
    if (!apiKey) {
      return apiError(request, 400, "API Key is required", { requestId });
    }
    if (!name) {
      return apiError(request, 400, "Name is required", { requestId });
    }

    let providerSpecificData = null;

    if (isOpenAICompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return apiError(request, 404, "OpenAI Compatible node not found", { requestId });
      }

      providerSpecificData = {
        prefix: node.prefix,
        apiType: node.apiType,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isAnthropicCompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return apiError(request, 404, "Anthropic Compatible node not found", { requestId });
      }

      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (LOCAL_PROVIDERS[provider]) {
      const nodes = await getProviderNodes();
      const expectedApiType = provider === "ollama" ? "ollama" : "openai";
      const localNode = (nodes || []).find(
        (node) =>
          node.type === "local" &&
          node.apiType === expectedApiType &&
          typeof node.baseUrl === "string" &&
          node.baseUrl.length > 0
      );

      if (!localNode) {
        return apiError(request, 400, `No local runtime node configured for ${provider}. Configure Local Runtimes first.`, { requestId });
      }

      providerSpecificData = {
        baseUrl: localNode.baseUrl,
        apiType: localNode.apiType,
        nodeName: localNode.name || provider,
      };
    }

    const newConnection = await createProviderConnection({
      provider,
      authType: "apikey",
      name,
      apiKey,
      priority: priority || 1,
      globalPriority: globalPriority || null,
      defaultModel: defaultModel || null,
      providerSpecificData,
      isActive: true,
      testStatus: testStatus || "unknown",
    });

    // Keep provider/model lists fresh right after a new connection is added.
    try {
      await syncProviderCatalog({
        force: true,
        providers: [provider],
        triggeredBy: "provider_connected",
      });
    } catch (syncError) {
      console.log(`Provider catalog sync skipped for ${provider}:`, syncError?.message || syncError);
    }

    // Hide sensitive fields and expose UI-safe status flags.
    const result = toSafeProviderConnection(newConnection);

    // Auto sync to Cloud if enabled
    await syncToCloudIfEnabled();

    return withStandardHeaders(NextResponse.json({ connection: result }, { status: 201 }), requestId);
  } catch (error) {
    console.log("Error creating provider:", error);
    return apiError(request, 500, "Failed to create provider");
  }
}

/**
 * Sync to Cloud if enabled
 */
async function syncToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing providers to cloud:", error);
  }
}
