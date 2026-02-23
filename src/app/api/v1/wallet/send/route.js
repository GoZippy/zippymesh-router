import { NextResponse } from "next/server";
import { openPaymentChannel } from "@/lib/sidecar.js";

export async function POST(req) {
    try {
        const body = await req.json();
        const { to, amount } = body;

        if (!to || !amount) {
            return NextResponse.json({ error: "Missing 'to' or 'amount'" }, { status: 400 });
        }

        const transaction = await openPaymentChannel(to, parseFloat(amount));

        return NextResponse.json({ success: true, transaction });
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}
