import { NextResponse } from "next/server";
import {
  getProviderConnections,
  getProviderNodes,
  getRateLimitConfigs,
  getRateLimitState,
} from "@/lib/localDb";
import { PROVIDER_TIER, PROVIDER_SOURCE } from "@/shared/constants/pricing";

/**
 * GET /api/provider-status
 * Returns provider health, rate limits, cooldowns, and tier metadata.
 * Use for: checking if providers are available, maxed credits, time to reset.
 */
export async function GET() {
  try {
    const [connections, nodes, rateConfigs, rateState] = await Promise.all([
      getProviderConnections(),
      getProviderNodes(),
      getRateLimitConfigs(),
      getRateLimitState(),
    ]);

    const now = Date.now();
    const providers = [];
    const localNodes = nodes.filter((n) => n.type === "local");

    // Build provider status from connections
    for (const conn of connections) {
      const tier = PROVIDER_TIER[conn.provider] || { tier: "unknown", resetSchedule: "unknown" };
      const source = PROVIDER_SOURCE[conn.provider] || "api-key";

      const rateLimitedUntil = conn.rateLimitedUntil ? new Date(conn.rateLimitedUntil).getTime() : 0;
      const isRateLimited = rateLimitedUntil > now;
      const resetInMs = isRateLimited ? rateLimitedUntil - now : 0;

      // Check rate limit state from token bucket
      let rateLimitStatus = null;
      if (rateState?.windows) {
        const keys = Object.keys(rateState.windows).filter((k) => k.startsWith(`${conn.provider}:`));
        if (keys.length > 0) {
          const states = keys.map((k) => rateState.windows[k]).filter(Boolean);
          const nearestReset = states
            .map((s) => s?.resetTime)
            .filter(Boolean)
            .reduce((a, b) => Math.min(a, b), Infinity);
          if (nearestReset < Infinity) {
            rateLimitStatus = {
              resetAt: new Date(nearestReset).toISOString(),
              resetInSeconds: Math.max(0, Math.round((nearestReset - now) / 1000)),
            };
          }
        }
      }

      providers.push({
        id: conn.provider,
        name: conn.name || conn.provider,
        status: conn.testStatus || "unknown",
        isActive: conn.isActive !== false,
        isEnabled: conn.isEnabled !== false,
        lastError: conn.lastError || null,
        lastTested: conn.lastTested || null,
        rateLimited: isRateLimited,
        rateLimitedUntil: isRateLimited ? conn.rateLimitedUntil : null,
        resetInSeconds: isRateLimited ? Math.round(resetInMs / 1000) : null,
        rateLimitStatus,
        tier: tier.tier,
        source,
        freeTier: tier.freeTier ?? false,
        rpm: tier.rpm ?? null,
        tpm: tier.tpm ?? null,
        resetSchedule: tier.resetSchedule ?? "unknown",
      });
    }

    // Add local nodes (Ollama, LM Studio) - each baseUrl is a distinct route
    const seenLocal = new Set();
    for (const node of localNodes) {
      const providerId = node.apiType === "ollama" ? "ollama" : "lmstudio";
      const key = `${providerId}:${node.baseUrl}`;
      if (seenLocal.has(key)) continue;
      seenLocal.add(key);

      const tier = PROVIDER_TIER[providerId] || { tier: "local", resetSchedule: "none" };
      providers.push({
        id: providerId,
        name: node.name || `${providerId === "ollama" ? "Ollama" : "LM Studio"} (${node.baseUrl})`,
        baseUrl: node.baseUrl,
        status: "unknown",
        isActive: true,
        isEnabled: true,
        rateLimited: false,
        tier: tier.tier,
        source: "local",
        freeTier: true,
        resetSchedule: "none",
        isLocalNode: true,
      });
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      providers,
      summary: {
        total: providers.length,
        active: providers.filter((p) => p.isActive && p.status === "active").length,
        rateLimited: providers.filter((p) => p.rateLimited).length,
        local: providers.filter((p) => p.source === "local").length,
      },
      rateLimitConfigs: Object.keys(rateConfigs || {}).length,
    });
  } catch (error) {
    console.error("[provider-status] Error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
