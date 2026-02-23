import { NextResponse } from "next/server";
import { getP2pOffers, getP2pSubscriptions, createP2pSubscription, updateP2pOffers, getProviderNodes } from "@/lib/localDb";
import { getWalletBalance, getWalletEarnings, getWalletTransactions } from "@/lib/sidecar";

/**
 * GET /api/marketplace
 * Returns available offers from peers and current subscriptions.
 */
export async function GET() {
    try {
        const nodes = await getProviderNodes();
        const peerNodes = nodes.filter(n => n.type === "peer" || n.type === "local");

        // Refresh offers from discovered nodes
        const offers = await updateP2pOffers(peerNodes);
        const subscriptions = await getP2pSubscriptions();
        const earnings = await getWalletEarnings();
        const balance = await getWalletBalance();
        const transactions = await getWalletTransactions();

        return NextResponse.json({
            success: true,
            offers,
            subscriptions,
            earnings,
            balance,
            transactions
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

/**
 * POST /api/marketplace
 * Subscribes to a peer offer.
 */
export async function POST(req) {
    try {
        const { offerId, name } = await req.json();

        if (!offerId || !name) {
            return NextResponse.json({ success: false, error: "offerId and name are required" }, { status: 400 });
        }

        const subscription = await createP2pSubscription(offerId, name);

        return NextResponse.json({
            success: true,
            subscription
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
