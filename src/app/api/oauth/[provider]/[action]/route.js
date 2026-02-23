import { NextResponse } from "next/server";
import {
  getProvider,
  generateAuthData,
  exchangeTokens,
  requestDeviceCode,
  pollForToken
} from "@/lib/oauth/providers";
import { createProviderConnection, isCloudEnabled } from "@/models";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/app/api/sync/cloud/route";

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
        return NextResponse.json({ error: "Provider does not support device code flow" }, { status: 400 });
      }

      const authData = generateAuthData(provider, null);

      // For providers that don't use PKCE (like GitHub), don't pass codeChallenge
      let deviceData;
      if (provider === "github" || provider === "kiro") {
        // GitHub and Kiro don't use PKCE for device code
        deviceData = await requestDeviceCode(provider);
      } else {
        // Qwen and other providers use PKCE
        deviceData = await requestDeviceCode(provider, authData.codeChallenge);
      }

      return NextResponse.json({
        ...deviceData,
        codeVerifier: authData.codeVerifier,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.log("OAuth GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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
      const { code, redirectUri, codeVerifier, state, connectionId } = body;
      console.log(`[OAuth] Exchanging code for ${provider}`, { code: code?.substring(0, 10) + "...", redirectUri });

      if (!code || !redirectUri || !codeVerifier) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      // Exchange code for tokens
      const tokenData = await exchangeTokens(provider, code, redirectUri, codeVerifier, state);

      // Save to database
      console.log(`[OAuth] Saving connection for ${provider} (${tokenData.email || 'no email'})`);
      const connection = await createProviderConnection({
        provider,
        authType: "oauth",
        connectionId,
        ...tokenData,
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
        return NextResponse.json({ error: "Missing device code" }, { status: 400 });
      }

      // For providers that don't use PKCE (like GitHub, Kiro), don't pass codeVerifier
      let result;
      if (provider === "github") {
        result = await pollForToken(provider, deviceCode);
      } else if (provider === "kiro") {
        // Kiro needs extraData (clientId, clientSecret) from device code response
        result = await pollForToken(provider, deviceCode, null, extraData);
      } else {
        // Qwen and other providers use PKCE
        if (!codeVerifier) {
          return NextResponse.json({ error: "Missing code verifier" }, { status: 400 });
        }
        result = await pollForToken(provider, deviceCode, codeVerifier);
      }

      if (result.success) {
        // Save to database
        console.log(`[OAuth] Saving device code connection for ${provider}`);
        const connection = await createProviderConnection({
          provider,
          authType: "oauth",
          connectionId,
          ...result.tokens,
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

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.log("OAuth POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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
    console.log("Error syncing to cloud after OAuth:", error);
  }
}
