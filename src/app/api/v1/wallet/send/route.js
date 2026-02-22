import { NextResponse } from "next/server";
import { recordP2pTransaction } from "@/lib/localDb.js";

export async function POST(req) {
    try {
        const body = await req.json();
        const { to, amount } = body;

        if (!to || !amount) {
            return NextResponse.json({ error: "Missing 'to' or 'amount'" }, { status: 400 });
        }

        const transaction = await recordP2pTransaction({
            type: "spend",
            amount: parseFloat(amount),
            offerId: to,
            model: "direct-transfer",
            tokens: { total_tokens: 0 }
        });

        return NextResponse.json({ success: true, transaction });
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}
