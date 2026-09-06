import { NextResponse } from "next/server";
import { walletSend } from "@/lib/sidecar.js";
import { apiError } from "@/lib/apiErrors.js";
import { requireAuth } from "@/lib/auth/middleware.js";

/**
 * POST /api/v1/wallet/send — submit a real signed on-chain ZPC transfer.
 * Body: { to, valueZat? , amount? }
 *   - valueZat: integer ZAT (exact; preferred)
 *   - amount:   decimal ZIP as a string (converted to ZAT server-side with
 *               fixed-point math — passed through as a string to avoid the
 *               float rounding that parseFloat previously introduced)
 *
 * AUTH (2026-08-30 audit, finding C3): wrapped in requireAuth.
 *
 * This route moves real money: the sidecar holds the ML-DSA key and signs
 * whatever `to`/amount arrives here. It sits under /api/v1, and src/middleware.js
 * deliberately excludes /api/v1* from the edge gate (`isV1Api` short-circuits
 * `isManagementApi`) so the OpenAI-compatible surface can be called with an API
 * key instead of a cookie. The effect was that this endpoint had NO auth at all
 * — anyone who could reach the port could drain the node wallet to an address
 * of their choosing.
 *
 * requireAuth is the right gate because the only caller is the dashboard wallet
 * page (src/app/(dashboard)/dashboard/wallet/page.js), which is a browser
 * session. It is not part of the OpenAI-compatible contract and no CLI or SDK
 * consumes it. Note requireAuth still passes when `settings.requireLogin` is
 * false, matching every other guarded route in the app — see the LAN threat
 * model in docs/_internal/SECURITY_AUDIT_2026-08-30.md for why "open" mode must
 * not be exposed off-host.
 */
async function sendHandler(req) {
    try {
        const body = await req.json();
        const { to, amount, valueZat } = body;

        if (!to || (amount == null && valueZat == null)) {
            return apiError(req, 400, "Missing 'to' and one of 'valueZat' | 'amount'");
        }

        const transaction = await walletSend(to,
            valueZat != null ? { valueZat } : { amountZip: String(amount) });

        return NextResponse.json({ success: true, transaction });
    } catch (error) {
        // Surface the sidecar/node rejection reason (e.g. pubkey not
        // registered, insufficient balance) instead of a blanket 500.
        return apiError(req, 502, error?.message || "wallet send failed");
    }
}

export const POST = requireAuth(sendHandler);
