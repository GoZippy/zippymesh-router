import { NextResponse } from "next/server";
import { openPaymentChannel } from "@/lib/sidecar.js";
import { apiError } from "@/lib/apiErrors.js";

export async function POST(req) {
    try {
        const body = await req.json();
        const { to, amount } = body;

        if (!to || !amount) {
            return apiError(req, 400, "Missing 'to' or 'amount'");
        }

        const transaction = await openPaymentChannel(to, parseFloat(amount));

        return NextResponse.json({ success: true, transaction });
    } catch (error) {
        return apiError(req, 500, "Internal Server Error");
    }
}
