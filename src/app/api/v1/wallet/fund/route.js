import { NextResponse } from "next/server";
import { devFundWallet, getSidecarWalletAddress } from "@/lib/sidecar.js";
import { apiError } from "@/lib/apiErrors.js";
import { requireAuth } from "@/lib/auth/middleware.js";

/**
 * POST /api/v1/wallet/fund — DEV-ONLY faucet.
 *
 * Funds a zpc1 address from an operator-designated funded wallet (the sidecar
 * signs FROM ZIPPY_DEV_FAUCET_SEED). No funds are fabricated — the operator
 * must point the faucet at a wallet that already holds ZIP. Returns 403 from
 * the sidecar when the faucet seed isn't configured.
 *
 * Body: { to?, valueZat?, amount? }
 *   - to defaults to this node's own zpc1 wallet address (fund myself)
 *   - provide valueZat (integer ZAT) or amount (decimal ZIP string)
 *
 * AUTH (2026-08-30 audit, finding C3): wrapped in requireAuth, for the same
 * reason as the sibling /api/v1/wallet/send — /api/v1* is excluded from the
 * edge gate in src/middleware.js, so this route previously had no auth at all
 * and let any reachable caller drain the operator's faucet wallet
 * (ZIPPY_DEV_FAUCET_SEED) to an arbitrary address, 10 ZIP at a time by default.
 * The only caller is the dashboard wallet page, which carries a session.
 */
async function fundHandler(req) {
    try {
        const body = await req.json().catch(() => ({}));
        let { to, amount, valueZat } = body;

        if (!to) {
            to = await getSidecarWalletAddress();
            if (!to) return apiError(req, 502, "Could not resolve local wallet address (is the sidecar running?)");
        }
        if (amount == null && valueZat == null) {
            amount = "10"; // sensible dev default: 10 ZIP
        }

        const result = await devFundWallet(to,
            valueZat != null ? { valueZat } : { amountZip: String(amount) });

        return NextResponse.json({ success: true, to, result });
    } catch (error) {
        return apiError(req, 502, error?.message || "dev fund failed");
    }
}

export const POST = requireAuth(fundHandler);
