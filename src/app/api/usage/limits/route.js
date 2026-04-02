import { NextResponse } from "next/server";
import { getProviderConnections, getRateLimitConfigs, getRateLimitState } from "@/lib/localDb.js";
import { apiError } from "@/lib/apiErrors.js";

function toMillis(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function deriveBucketUsage(provider, bucket, windows) {
  const prefix = `${provider}:${bucket.name}:`;
  const relevant = Object.entries(windows || {}).filter(([key]) => key.startsWith(prefix));

  const limit = Number(bucket.value_hint || 0);
  const unit = bucket.unit || "requests";
  let used = 0;
  let resetTime = 0;

  for (const [, state] of relevant) {
    const count = unit === "tokens" ? Number(state?.tokens || 0) : Number(state?.count || 0);
    used = Math.max(used, Number.isFinite(count) ? count : 0);
    const stateReset = Number(state?.resetTime || 0);
    if (Number.isFinite(stateReset)) {
      resetTime = Math.max(resetTime, stateReset);
    }
  }

  const remaining = limit > 0 ? Math.max(0, limit - used) : null;
  return {
    bucketName: bucket.name,
    unit,
    windowSeconds: Number(bucket.window_seconds || 0),
    windowType: bucket.window_type || "rolling",
    appliesTo: bucket.applies_to || "all",
    limit,
    used,
    remaining,
    resetTime: resetTime ? new Date(resetTime).toISOString() : null,
    helpText: `${bucket.name}: ${limit > 0 ? limit : "dynamic"} ${unit}/${bucket.window_seconds || "?"}s`,
  };
}

export async function GET(request) {
  try {
    const [connections, configs, state] = await Promise.all([
      getProviderConnections({ isActive: true, isEnabled: true }),
      getRateLimitConfigs(),
      getRateLimitState(),
    ]);

    const windows = state?.windows || {};
    const now = Date.now();
    const rows = connections.map((connection) => {
      const providerConfig = configs?.[connection.provider] || { buckets: [] };
      const buckets = (providerConfig.buckets || []).map((bucket) =>
        deriveBucketUsage(connection.provider, bucket, windows)
      );

      const exceeded = buckets.filter((bucket) => bucket.limit > 0 && (bucket.remaining ?? 0) <= 0);
      const exceededReset = exceeded
        .map((bucket) => toMillis(bucket.resetTime))
        .filter((value) => value > now);
      const cooldownUntil = toMillis(connection.rateLimitedUntil);
      const availableAgainMs = Math.max(cooldownUntil, exceededReset.length ? Math.max(...exceededReset) : 0);

      const status =
        cooldownUntil > now
          ? "cooldown"
          : exceeded.length > 0
            ? "rate_limited"
            : "available";

      const tier =
        connection.metadata?.tier ||
        connection.providerSpecificData?.tier ||
        connection.metadata?.plan ||
        "unknown";

      return {
        connectionId: connection.id,
        provider: connection.provider,
        accountName: connection.name || connection.email || connection.id.slice(0, 8),
        tier,
        status,
        availableAgainAt: availableAgainMs > now ? new Date(availableAgainMs).toISOString() : null,
        buckets,
        cooldown: {
          rateLimitedUntil: connection.rateLimitedUntil || null,
          isCoolingDown: cooldownUntil > now,
        },
      };
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      connections: rows,
    });
  } catch (error) {
    console.error("Error fetching usage limits:", error);
    return apiError(request, 500, "Failed to fetch usage limits");
  }
}

