import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";

export async function GET() {
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    // If updating password, hash it
    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;

      // Verify current password if it exists
      if (currentHash) {
        if (!body.currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(body.currentPassword, currentHash);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {
        // First time setting password, no current password needed
        // Allow empty currentPassword or default "123456"
        if (body.currentPassword && body.currentPassword !== "123456") {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(body.newPassword, salt);
      delete body.newPassword;
      delete body.currentPassword;
    }

    const settings = await updateSettings(body);

    // Sync pricing to Sidecar if pricePer1k was updated
    if (body.pricePer1k !== undefined) {
      try {
        // pricePer1k is in ZIP, Sidecar expects base_price_per_token (also in ZIP/token)
        // Assuming 1k tokens = 1 unit of pricePer1k
        // So base_price_per_token = pricePer1k / 1000
        const basePrice = body.pricePer1k / 1000;

        await fetch("http://localhost:8081/node/pricing", {
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
