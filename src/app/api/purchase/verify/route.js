import { NextResponse } from "next/server";
import { getActiveLicense, getPurchaseById } from "@/lib/localDb.js";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get("wallet");
  const licenseKey = searchParams.get("license");
  const purchaseId = searchParams.get("purchaseId");

  if (!walletAddress && !licenseKey && !purchaseId) {
    return NextResponse.json(
      { error: "One of wallet, license, or purchaseId is required" },
      { status: 400 }
    );
  }

  try {
    if (purchaseId) {
      const purchase = await getPurchaseById(purchaseId);
      if (!purchase) {
        return NextResponse.json({ valid: false, reason: "purchase_not_found" });
      }
      return NextResponse.json({
        valid: purchase.status === "completed",
        purchase: {
          id: purchase.id,
          productId: purchase.productId,
          status: purchase.status,
          licenseKey: purchase.licenseKey,
          activatedAt: purchase.activatedAt,
          expiresAt: purchase.expiresAt,
        },
      });
    }

    if (walletAddress) {
      const license = await getActiveLicense(walletAddress);
      if (!license) {
        return NextResponse.json({ valid: false, reason: "no_active_license" });
      }

      if (licenseKey && license.licenseKey !== licenseKey) {
        return NextResponse.json({ valid: false, reason: "license_mismatch" });
      }

      return NextResponse.json({
        valid: true,
        license: {
          productId: license.productId,
          licenseKey: license.licenseKey,
          activatedAt: license.activatedAt,
          expiresAt: license.expiresAt,
          walletAddress: license.walletAddress,
        },
      });
    }

    return NextResponse.json({ valid: false, reason: "invalid_request" });
  } catch (error) {
    console.error("[Purchase/Verify] Error:", error);
    return NextResponse.json(
      { error: "Verification failed", details: error.message },
      { status: 500 }
    );
  }
}
