import { NextResponse } from "next/server";
import { getNodeWallet, getSettings } from "@/lib/localDb.js";
import { zippyRpc } from "@/lib/zippycoin-wallet.js";

export async function GET() {
    try {
        const settings = await getSettings();

        if (settings.isDemoMode) {
            return NextResponse.json({
                balance: 10240.0,
                currency: "ZIP",
                address: "ZIP-DEMO",
                symbol: "ZIPc"
            });
        }

        const wallet = await getNodeWallet();

        if (!wallet) {
            return NextResponse.json({
                balance: 0,
                currency: "ZIP",
                address: "No wallet linked",
                symbol: "ZIPc"
            });
        }

        // Attempt to fetch live balance from the ZippyCoin RPC node.
        // Falls back to the locally-cached balance if the chain is unreachable.
        let balance = wallet.balance || 0;
        try {
            const balanceHex = await zippyRpc("eth_getBalance", [wallet.address, "latest"]);
            if (balanceHex && typeof balanceHex === "string") {
                const balanceWei = BigInt(balanceHex);
                balance = Number(balanceWei) / 1e18;
            }
        } catch (rpcErr) {
            console.warn(
                `[balance/route] ZippyCoin RPC unreachable, using cached balance for ${wallet.address}:`,
                rpcErr.message
            );
            // balance remains wallet.balance (last known value)
        }

        return NextResponse.json({
            balance,
            address: wallet.address,
            name: wallet.name,
            currency: "ZIP",
            symbol: "ZIPc"
        });
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}
