import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { checkAuth } from "@/lib/auth/middleware.js";
import { apiError } from "@/lib/apiErrors.js";

// GET /api/providers/health - Summary of all provider connection health
export async function GET(request) {
  try {
    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }

    const connections = await getProviderConnections();
    const now = Date.now();
    const twoHoursMs = 2 * 60 * 60 * 1000;

    let active = 0;
    let expiringSoon = 0;
    let needsReauth = 0;
    let rateLimited = 0;
    let unavailable = 0;

    const summary = connections.map((c) => {
      const expiresAt = c.expiresAt ? new Date(c.expiresAt).getTime() : null;
      const isExpired = expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= now;
      const isExpiringSoon =
        expiresAt !== null &&
        Number.isFinite(expiresAt) &&
        expiresAt > now &&
        expiresAt - now < twoHoursMs;
      const isRateLimited =
        c.rateLimitedUntil != null &&
        new Date(c.rateLimitedUntil).getTime() > now;

      if (c.testStatus === "needs_reauth") {
        needsReauth++;
      } else if (c.testStatus === "unavailable") {
        unavailable++;
      } else if (isRateLimited) {
        rateLimited++;
      } else if (c.testStatus === "active" && !isExpired) {
        active++;
      }

      if (isExpiringSoon) {
        expiringSoon++;
      }

      return {
        id: c.id,
        provider: c.provider,
        name: c.name,
        testStatus: c.testStatus,
        expiresAt: c.expiresAt || null,
        rateLimitedUntil: c.rateLimitedUntil || null,
        lastError: c.lastError || null,
      };
    });

    return NextResponse.json({
      total: connections.length,
      active,
      expiringSoon,
      needsReauth,
      rateLimited,
      unavailable,
      connections: summary,
    });
  } catch (error) {
    console.log("Error fetching provider health:", error);
    return apiError(request, 500, "Failed to fetch provider health");
  }
}
