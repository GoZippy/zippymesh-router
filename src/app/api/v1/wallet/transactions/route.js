import { NextResponse } from "next/server";
import { getWalletTransactions } from "@/lib/sidecar.js";

export async function GET() {
    try {
        const transactions = await getWalletTransactions();

        // Format for the Wallet UI
        const formatted = transactions.map(tx => ({
            id: tx.id,
            timestamp: Math.floor(new Date(tx.timestamp).getTime() / 1000),
            type: tx.type === "earn" ? "credit" : "debit",
            description: `${tx.type === 'earn' ? 'Earned from' : 'Paid to'} ${tx.offerId?.slice(0, 8)} (${tx.model})`,
            amount: tx.type === "earn" ? tx.amount : -tx.amount
        }));

        return NextResponse.json(formatted);
    } catch (error) {
        console.error("Transactions API Error:", error);
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
