import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";
// Fallback for removed isCloudEnabled function
const isCloudEnabled = async () => false;

import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/syncCloud";
import { syncProviderCatalog } from "@/lib/providers/sync";
import { apiError } from "@/lib/apiErrors";

/**
 * POST /api/oauth/kiro/import
 * Import and validate refresh token from Kiro IDE
 */
export async function POST(request) {
  try {
    const { refreshToken } = await request.json();

    if (!refreshToken || typeof refreshToken !== "string") {
      return apiError(request, 400, "Refresh token is required");
    }

    const kiroService = new KiroService();

    // Validate and refresh token
    const tokenData = await kiroService.validateImportToken(refreshToken.trim());

    // Extract email from JWT if available
    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);

    // Save to database
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
      email: email || null,
      providerSpecificData: {
        profileArn: tokenData.profileArn,
        authMethod: "imported",
        provider: "Imported",
      },
      testStatus: "active",
    });

    // Auto sync to Cloud if enabled
    await syncToCloudIfEnabled();
    try {
      await syncProviderCatalog({
        force: true,
        providers: ["kiro"],
        triggeredBy: "oauth_connected",
      });
    } catch (syncError) {
      console.log("Provider catalog sync skipped for kiro:", syncError?.message || syncError);
    }

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.log("Kiro import token error:", error);
    return apiError(request, 500, "Kiro token import failed");
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
    console.log("Error syncing to cloud after Kiro import:", error);
  }
}
