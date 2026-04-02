import { NextResponse } from "next/server";
import { getSqliteDb } from "@/lib/localDb.js";

export async function GET() {
  try {
    const db = getSqliteDb();

    let hasProvider = false;
    let hasFallbackChain = false;
    let hasApiKey = false;
    let hasFirstRequest = false;

    if (db) {
      // 1. At least one active provider connection
      const providerRow = db.prepare(
        `SELECT COUNT(*) as c FROM provider_connections WHERE isActive = 1 AND testStatus = 'success'`
      ).get();
      hasProvider = (providerRow?.c ?? 0) > 0;

      // 2. At least one combo (fallback chain)
      // Check the lowdb combos — we need to read from JSON db or check if there's a combos table
      // combos are stored in lowdb JSON, not SQLite. Check if there's a combos count API we can call.
      // Since we can't call our own API from a route handler easily, check the lowdb data file directly:
      const path = await import("node:path");
      const os = await import("node:os");
      const fs = await import("node:fs");

      const appName = process.env.ZIPPY_APP_NAME || "zippy-mesh";
      const homeDir = os.default.homedir();
      const dataDir = process.env.DATA_DIR ||
        (process.platform === "win32"
          ? `${process.env.APPDATA || homeDir + "\\AppData\\Roaming"}\\${appName}`
          : `${homeDir}/.${appName}`);
      const dbPath = path.default.join(dataDir, "db.json");

      if (fs.default.existsSync(dbPath)) {
        try {
          const dbData = JSON.parse(fs.default.readFileSync(dbPath, "utf-8"));
          hasFallbackChain = (dbData?.combos?.length ?? 0) > 0;
          hasApiKey = (dbData?.routerApiKeys?.filter(k => !k.revoked)?.length ?? 0) > 0 ||
                     (dbData?.apiKeys?.filter(k => !k.revoked)?.length ?? 0) > 0;
        } catch (e) {
          // JSON parse failed, leave as false
        }
      }

      // Also check SQLite router_api_keys table
      if (!hasApiKey) {
        const keyRow = db.prepare(`SELECT COUNT(*) as c FROM router_api_keys WHERE revoked = 0`).get();
        hasApiKey = (keyRow?.c ?? 0) > 0;
      }

      // 4. First successful request trace
      const traceRow = db.prepare(
        `SELECT COUNT(*) as c FROM request_traces WHERE success = 1`
      ).get();
      hasFirstRequest = (traceRow?.c ?? 0) > 0;

      // If request_traces doesn't exist yet, fall back to routing_decisions
      if (!hasFirstRequest) {
        try {
          const decisionRow = db.prepare(
            `SELECT COUNT(*) as c FROM routing_decisions WHERE success = 1`
          ).get();
          hasFirstRequest = (decisionRow?.c ?? 0) > 0;
        } catch (e) {
          // table might not exist
        }
      }
    }

    const steps = [
      { id: "provider", label: "Connect a provider", done: hasProvider, ctaPath: "/dashboard/providers" },
      { id: "fallback_chain", label: "Create a fallback chain", done: hasFallbackChain, ctaPath: "/dashboard/combos" },
      { id: "api_key", label: "Configure an API key", done: hasApiKey, ctaPath: "/dashboard/endpoint" },
      { id: "first_request", label: "Make your first request", done: hasFirstRequest, ctaPath: "/dashboard/quickstart" },
    ];

    const completedCount = steps.filter(s => s.done).length;
    const allDone = completedCount === steps.length;

    return NextResponse.json({ steps, allDone, completedCount });
  } catch (error) {
    console.error("[SetupStatus] Error:", error);
    return NextResponse.json(
      { steps: [], allDone: false, completedCount: 0, error: error.message },
      { status: 500 }
    );
  }
}
