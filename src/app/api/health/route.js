import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { initLocalProviderConnections } from "@/lib/localDb";
import path from "path";
import fs from "fs";

// One-time initialization flag
let _localProvidersInitialized = false;

async function ensureLocalProvidersInitialized() {
  if (_localProvidersInitialized) return;
  try {
    const synced = await initLocalProviderConnections();
    if (synced > 0) {
      console.log(`[Init] Synced ${synced} local provider connections`);
    }
    _localProvidersInitialized = true;
  } catch (error) {
    console.error("[Init] Error syncing local providers:", error.message);
  }
}

function getVersion() {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      return pkg.version || "unknown";
    }
  } catch (_) {}
  return "unknown";
}

export async function GET() {
  // Ensure local providers are synced on first health check
  await ensureLocalProvidersInitialized();
  try {
    const connections = await getProviderConnections();
    const activeCount = connections.filter(c => c.testStatus === "active").length;

    const rateLimited = connections.filter(c => {
      const until = c.rateLimitedUntil ? new Date(c.rateLimitedUntil).getTime() : 0;
      return until > Date.now();
    }).length;

    return NextResponse.json({
      ok: true,
      status: "ok",
      service: "zippymesh",
      version: getVersion(),
      uptime: process.uptime(),
      providersConfigured: connections.length,
      providersActive: activeCount,
      providersRateLimited: rateLimited,
      timestamp: new Date().toISOString(),
      apiVersion: "v1",
      endpoints: {
        models: "/v1/models",
        chat: "/v1/chat/completions",
        providerStatus: "/api/provider-status",
        rateLimits: "/api/tokenbuddy/rate-limits?all=true"
      }
    });
  } catch (error) {
    console.error("[health] Error:", error.message);
    return NextResponse.json(
      {
        ok: false,
        status: "error",
        service: "zippymesh",
        version: getVersion(),
        message: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
