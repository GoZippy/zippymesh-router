import { NextResponse } from "next/server";
import { getSettings, updateSettings, getFirstRun, writeAuditLog } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { apiError } from "@/lib/apiErrors.js";

export async function GET(request) {
  try {
    const settings = await getSettings();
    const { password, ...safeSettings } = settings;

    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";

    return NextResponse.json({
      ...safeSettings,
      enableRequestLogs,
      hasPassword: !!password
    });
  } catch (error) {
    console.log("Error getting settings:", error);
    return apiError(request, 500, "Failed to load settings");
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    // If updating password, hash it
    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;
      const firstRun = await getFirstRun();

      // During setup (firstRun), allow setting password without currentPassword
      if (firstRun) {
        // Initial setup: no current password needed
      } else if (currentHash) {
        // Post-setup: require current password to change
        if (!body.currentPassword) {
          return apiError(request, 400, "Current password required");
        }
        const isValid = await bcrypt.compare(body.currentPassword, currentHash);
        if (!isValid) {
          return apiError(request, 401, "Invalid current password");
        }
      } else {
        // No hash yet, not first run: allow if INITIAL_PASSWORD matches (env bootstrap)
        const initialPassword = process.env.INITIAL_PASSWORD;
        const envPassword = typeof initialPassword === "string" ? initialPassword.trim() : "";
        const current = typeof body.currentPassword === "string" ? body.currentPassword.trim() : "";
        if (current && envPassword && current !== envPassword) {
          return apiError(request, 401, "Invalid current password");
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(body.newPassword, salt);
      delete body.newPassword;
      delete body.currentPassword;
    }

    const settings = await updateSettings(body);

    // Non-blocking audit log write
    writeAuditLog({ action: 'settings_change', resourceType: 'settings' });

    // Sync pricing to Sidecar if pricePer1k was updated
    if (body.pricePer1k !== undefined) {
      try {
        // pricePer1k is in ZIP, Sidecar expects base_price_per_token (also in ZIP/token)
        // Assuming 1k tokens = 1 unit of pricePer1k
        // So base_price_per_token = pricePer1k / 1000
        const basePrice = body.pricePer1k / 1000;

        const { fetchSidecarWithTimeout } = await import("@/lib/sidecar.js");
        await fetchSidecarWithTimeout("/node/pricing", 5000, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_price_per_token: basePrice,
            min_price_per_token: basePrice * 0.5, // Simple logic
            congestion_multiplier: 1.0
          })
        });
      } catch (err) {
        console.error("Failed to sync pricing to Sidecar:", err);
        // Don't fail the request, just log error
      }
    }

    const { password, ...safeSettings } = settings;
    return NextResponse.json(safeSettings);
  } catch (error) {
    console.log("Error updating settings:", error);
    return apiError(request, 500, "Failed to update settings");
  }
}
