import { NextResponse } from "next/server";
import { getWalletTransactions, addWalletTransaction } from "@/lib/localDb.js";

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const walletId = searchParams.get("walletId");

        if (!walletId) {
            return NextResponse.json({ error: "Wallet ID is required" }, { status: 400 });
        }

        const transactions = await getWalletTransactions(walletId);
        return NextResponse.json(transactions);
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}

export async function POST(req) {
    try {
        const data = await req.json();

        if (!data.wallet_id || !data.type || !data.amount) {
            return NextResponse.json({ error: "Wallet ID, type, and amount are required" }, { status: 400 });
        }

        const transaction = await addWalletTransaction({
            wallet_id: data.wallet_id,
            type: data.type,
            amount: data.amount,
            symbol: data.symbol || "ZIPc",
            status: data.status || "confirmed",
            counterparty: data.counterparty,
            txHash: data.txHash,
            description: data.description,
            timestamp: data.timestamp,
            metadata: data.metadata || {}
        });

        return NextResponse.json(transaction);
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}
