import { NextResponse } from "next/server";
import { getDb, getSettings, updateSettings } from "@/lib/localDb.js";
import { v4 as uuidv4 } from "uuid";
import { apiError } from "@/lib/apiErrors";

/**
 * GET /api/profile
 * Returns the local profile data that can be synced to ZippyMesh.com
 */
export async function GET(request) {
  try {
    const db = await getDb();
    const settings = await getSettings();

    // Get or create a dApp instance ID
    let dAppInstanceId = db.data.dAppInstanceId;
    if (!dAppInstanceId) {
      dAppInstanceId = uuidv4();
      db.data.dAppInstanceId = dAppInstanceId;
      await db.write();
    }

    // Build profile data for sync (no secrets)
    const profile = {
      dAppInstanceId,
      dAppType: "zmlr",
      dAppVersion: process.env.npm_package_version || "0.2.7-alpha",
      settings: {
        routingMode: settings.routingMode || "auto",
        defaultPlaybookId: settings.defaultPlaybookId || null,
        dashboardView: settings.dashboardView || "simple",
        theme: settings.theme || "dark",
      },
      providersSummary: {
        oauthCount: (db.data.providerConnections || []).filter(c => c.isActive && c.authType === "oauth").length,
        apikeyCount: (db.data.providerConnections || []).filter(c => c.isActive && c.authType === "apikey").length,
        localCount: (db.data.providerNodes || []).filter(n => n.isActive).length,
      },
      linkedToZippyMesh: db.data.zippyMeshProfileId || null,
      lastSyncedAt: db.data.lastProfileSyncAt || null,
    };

    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Error fetching profile:", error);
    return apiError(request, 500, "Failed to fetch profile");
  }
}

/**
 * POST /api/profile
 * Link this dApp instance to a ZippyMesh.com profile
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const db = await getDb();

    if (body.action === "link") {
      // Link to ZippyMesh profile
      if (!body.zippyMeshProfileId) {
        return apiError(request, 400, "zippyMeshProfileId is required");
      }

      db.data.zippyMeshProfileId = body.zippyMeshProfileId;
      db.data.lastProfileSyncAt = new Date().toISOString();
      await db.write();

      return NextResponse.json({
        success: true,
        message: "Linked to ZippyMesh profile",
        zippyMeshProfileId: body.zippyMeshProfileId,
      });
    }

    if (body.action === "unlink") {
      // Unlink from ZippyMesh profile
      db.data.zippyMeshProfileId = null;
      db.data.lastProfileSyncAt = null;
      await db.write();

      return NextResponse.json({
        success: true,
        message: "Unlinked from ZippyMesh profile",
      });
    }

    if (body.action === "sync") {
      // Update local settings from ZippyMesh profile data
      if (body.settings) {
        const currentSettings = await getSettings();
        const newSettings = {
          ...currentSettings,
          routingMode: body.settings.routingMode || currentSettings.routingMode,
          defaultPlaybookId: body.settings.defaultPlaybookId || currentSettings.defaultPlaybookId,
          dashboardView: body.settings.dashboardView || currentSettings.dashboardView,
          theme: body.settings.theme || currentSettings.theme,
        };
        await updateSettings(newSettings);
      }

      db.data.lastProfileSyncAt = new Date().toISOString();
      await db.write();

      return NextResponse.json({
        success: true,
        message: "Profile synced",
        lastSyncedAt: db.data.lastProfileSyncAt,
      });
    }

    return apiError(request, 400, "Invalid action");
  } catch (error) {
    console.error("Error updating profile:", error);
    return apiError(request, 500, "Failed to update profile");
  }
}
