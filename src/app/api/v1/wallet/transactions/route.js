import { NextResponse } from "next/server";
import { getWalletTransactions, addWalletTransaction } from "@/lib/localDb.js";
import { apiError } from "@/lib/apiErrors.js";

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const walletId = searchParams.get("walletId");

        if (!walletId) {
            return apiError(req, 400, "Wallet ID is required");
        }

        const transactions = await getWalletTransactions(walletId);
        return NextResponse.json(transactions);
    } catch (error) {
        return apiError(req, 500, "Internal Server Error");
    }
}

export async function POST(req) {
    try {
        const data = await req.json();

        if (!data.wallet_id || !data.type || !data.amount) {
            return apiError(req, 400, "Wallet ID, type, and amount are required");
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
        return apiError(req, 500, "Internal Server Error");
    }
}
