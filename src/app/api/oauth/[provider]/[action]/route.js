import { NextResponse } from "next/server";
import {
  getProvider,
  generateAuthData,
  exchangeTokens,
  requestDeviceCode,
  pollForToken
} from "@/lib/oauth/providers";
import { requiresDeviceCodeExtraData, requiresDeviceCodePkce } from "@/shared/constants/providerCapabilities";
import {
  createProviderConnection,
  getProviderConnectionById,
  getProviderConnections,
} from "@/models";
import { isUsableClientSecret, resolveOAuthClientSecret } from "@/lib/oauth/utils/secrets";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/syncCloud";
import { syncProviderCatalog } from "@/lib/providers/sync";
import { apiError } from "@/lib/apiErrors";

// Fallback for removed isCloudEnabled function
const isCloudEnabled = async () => false;

async function syncToCloudIfEnabled() {
  const cloudEnabled = typeof isCloudEnabled === "function" ? await isCloudEnabled() : false;
  if (cloudEnabled) {
    try {
      await syncToCloud();
    } catch (err) {
      console.log("Auto-sync to cloud failed:", err.message);
    }
  }
}

function mergeProviderSpecificData(existingData, tokenData, provider, oauthClientSecret) {
  const merged = {
    ...(existingData && typeof existingData === "object" ? existingData : {}),
    ...(tokenData?.providerSpecificData && typeof tokenData.providerSpecificData === "object" ? tokenData.providerSpecificData : {}),
  };

  if (provider && isUsableClientSecret(oauthClientSecret)) {
    merged.oauth = {
      ...(merged.oauth && typeof merged.oauth === "object" ? merged.oauth : {}),
      [provider]: {
        ...((merged.oauth && merged.oauth[provider] && typeof merged.oauth[provider] === "object") ? merged.oauth[provider] : {}),
        clientSecret: oauthClientSecret.trim(),
      },
    };
  }

  return merged;
}

/**
 * Dynamic OAuth API Route
 * Handles: authorize, exchange, device-code, poll
 */

// GET /api/oauth/[provider]/authorize - Generate auth URL
// GET /api/oauth/[provider]/device-code - Request device code (for device_code flow)
export async function GET(request, { params }) {
  try {
    const { provider, action } = await params;
    const { searchParams } = new URL(request.url);

    if (action === "authorize") {
      const redirectUri = searchParams.get("redirect_uri") || "http://localhost:8080/callback";
      const authData = generateAuthData(provider, redirectUri);
      return NextResponse.json(authData);
    }

    if (action === "device-code") {
      const providerData = getProvider(provider);
      if (providerData.flowType !== "device_code") {
        return apiError(request, 400, "Provider does not support device code flow");
      }

      const authData = generateAuthData(provider, null);
      const needsCodeVerifier = requiresDeviceCodePkce(provider);
      let deviceData;
      if (needsCodeVerifier) {
        deviceData = await requestDeviceCode(provider, authData.codeChallenge);
      } else {
        deviceData = await requestDeviceCode(provider);
      }

      return NextResponse.json({
        ...deviceData,
        codeVerifier: authData.codeVerifier,
      });
    }

    // GET /api/oauth/[provider]/has-secret - Check if server has OAuth client secret (env or persisted)
    if (action === "has-secret") {
      try {
        const providerData = getProvider(provider);
        const secret = await resolveOAuthClientSecret(provider, providerData.config);
        return NextResponse.json({ hasSecret: !!secret });
      } catch {
        return NextResponse.json({ hasSecret: false });
      }
    }

    return apiError(request, 400, "Unknown action");
  } catch (error) {
    console.log("OAuth GET error:", error);
    return apiError(request, 500, "OAuth GET failed");
  }
}

// POST /api/oauth/[provider]/exchange - Exchange code for tokens and save
// POST /api/oauth/[provider]/poll - Poll for token (device_code flow)
export async function POST(request, { params }) {
  try {
    const { provider, action } = await params;
    const body = await request.json();
    console.log(`[OAuth] POST /api/oauth/${provider}/${action}`, { bodyKeys: Object.keys(body) });

    if (action === "exchange") {
      const { code, redirectUri, codeVerifier, state, connectionId, oauthClientSecret } = body;
      console.log(`[OAuth] Exchanging code for ${provider}`, { code: code?.substring(0, 10) + "...", redirectUri });

      if (!code || !redirectUri || !codeVerifier) {
        return apiError(request, 400, "Missing required fields");
      }

      const existingById = connectionId ? await getProviderConnectionById(connectionId) : null;
      const explicitSecret = isUsableClientSecret(oauthClientSecret) ? oauthClientSecret.trim() : null;

      // Exchange code for tokens
      const tokenData = await exchangeTokens(provider, code, redirectUri, codeVerifier, state, {
        connection: existingById,
        clientSecret: explicitSecret,
      });

      let existingForMerge = existingById;
      if (!existingForMerge && tokenData?.email) {
        const allConnections = await getProviderConnections();
        existingForMerge = (allConnections || []).find(
          (item) => item.provider === provider && item.authType === "oauth" && item.email === tokenData.email
        ) || null;
      }
      const providerSpecificData = mergeProviderSpecificData(
        existingForMerge?.providerSpecificData || existingForMerge?.metadata,
        tokenData,
        provider,
        explicitSecret
      );

      // Save to database
      console.log(`[OAuth] Saving connection for ${provider} (${tokenData.email || 'no email'})`);
      const connection = await createProviderConnection({
        ...tokenData,
        provider,
        authType: "oauth",
        connectionId,
        providerSpecificData,
        expiresAt: tokenData.expiresIn
          ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
          : null,
        testStatus: "active",
        // Explicitly clear any existing errors/cooldowns
        lastError: null,
        lastErrorAt: null,
        rateLimitedUntil: null,
      });

      console.log(`[OAuth] Connection successfully ${connection.updatedAt === connection.createdAt ? 'created' : 'updated'} for ${provider}`, {
        id: connection.id,
        email: connection.email,
        status: connection.testStatus
      });

      // Auto sync to Cloud if enabled
      await syncToCloudIfEnabled();
      try {
        await syncProviderCatalog({
          force: true,
          providers: [provider],
          triggeredBy: "oauth_connected",
        });
      } catch (syncError) {
        console.log(`Provider catalog sync skipped for ${provider}:`, syncError?.message || syncError);
      }

      console.log(`[OAuth] Connection created successfully for ${provider}`, { id: connection.id, email: connection.email });

      return NextResponse.json({
        success: true,
        connection: {
          id: connection.id,
          provider: connection.provider,
          email: connection.email,
          displayName: connection.displayName,
        }
      });
    }

    if (action === "poll") {
      const { deviceCode, codeVerifier, extraData, connectionId } = body;

      if (!deviceCode) {
        return apiError(request, 400, "Missing device code");
      }

      const needsCodeVerifier = requiresDeviceCodePkce(provider);
      const sendCodeVerifier = needsCodeVerifier ? codeVerifier : null;
      const usesExtraData = requiresDeviceCodeExtraData(provider);

      if (needsCodeVerifier && !codeVerifier) {
        return apiError(request, 400, "Missing code verifier");
      }

      const result = await pollForToken(provider, deviceCode, sendCodeVerifier, usesExtraData ? extraData : null);

      if (result.success) {
        // Save to database
        console.log(`[OAuth] Saving device code connection for ${provider}`);
        const connection = await createProviderConnection({
          ...result.tokens,
          provider,
          authType: "oauth",
          connectionId,
          expiresAt: result.tokens.expiresIn
            ? new Date(Date.now() + result.tokens.expiresIn * 1000).toISOString()
            : null,
          testStatus: "active",
          // Explicitly clear any existing errors/cooldowns
          lastError: null,
          lastErrorAt: null,
          rateLimitedUntil: null,
        });

        console.log(`[OAuth] Device code connection successfully synced for ${provider}`, {
          id: connection.id,
          status: connection.testStatus
        });

        // Auto sync to Cloud if enabled
        await syncToCloudIfEnabled();
        try {
          await syncProviderCatalog({
            force: true,
            providers: [provider],
            triggeredBy: "oauth_connected",
          });
        } catch (syncError) {
          console.log(`Provider catalog sync skipped for ${provider}:`, syncError?.message || syncError);
        }

        return NextResponse.json({
          success: true,
          connection: {
            id: connection.id,
            provider: connection.provider,
          }
        });
      }

      // Still pending or error - don't create connection for pending states
      const isPending = result.pending || result.error === "authorization_pending" || result.error === "slow_down";

      return NextResponse.json({
        success: false,
        error: result.error,
        errorDescription: result.errorDescription,
        pending: isPending,
      });
    }

    return apiError(request, 400, "Unknown action");
  } catch (error) {
    console.log("OAuth POST error:", error);
    return apiError(request, 500, "OAuth POST failed");
  }
}


