import { NextResponse } from "next/server";
import { getP2pSubscriptions, createP2pSubscription } from "@/lib/localDb";
import { getWalletBalance, getWalletEarnings, getWalletTransactions } from "@/lib/sidecar";

const SIDECAR_URL = process.env.SIDE_CAR_URL || "http://localhost:9480";

/**
 * GET /api/marketplace
 * Returns mesh peers (real P2P nodes) as offers, plus subscriptions and wallet data.
 */
export async function GET() {
    try {
        let offers = [];
        try {
            const peersRes = await fetch(`${SIDECAR_URL}/peers`, { cache: "no-store" });
            if (peersRes.ok) {
                const peers = await peersRes.json();
                offers = (Array.isArray(peers) ? peers : []).map((p) => ({
                    id: p.id || p.peer_id || p.peerId,
                    name: p.name || `Peer ${(p.id || p.peer_id || "").slice(0, 8)}`,
                    latency: p.latency_ms ?? p.latency ?? 0,
                    tps: p.tps ?? 0,
                    models: p.models || [],
                    price_config: p.price_config || {},
                    service_type: p.service_type || "Compute",
                }));
            }
        } catch (e) {
            console.warn("Marketplace: could not fetch mesh peers", e.message);
        }

        const subscriptions = await getP2pSubscriptions();

        const [earnings, balanceData, transactions] = await Promise.all([
            getWalletEarnings(),
            getWalletBalance(),
            getWalletTransactions()
        ]);

        return NextResponse.json({
            success: true,
            offers: offers,
            subscriptions: subscriptions || [],
            earnings: typeof earnings === 'number' ? earnings : 0,
            balance: typeof balanceData?.balance === 'number' ? balanceData.balance : 0,
            transactions: Array.isArray(transactions) ? transactions : []
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
