import { NextResponse } from "next/server";

const SIDECAR_URL = process.env.SIDE_CAR_URL || "http://localhost:8081";

export async function POST(req) {
    try {
        const body = await req.json();
        const { to, amount } = body;

        if (!to || !amount) {
            return NextResponse.json({ error: "Missing 'to' or 'amount'" }, { status: 400 });
        }

        const res = await fetch(`${SIDECAR_URL}/wallet/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to, amount: parseFloat(amount) }),
        });

        if (!res.ok) {
            return NextResponse.json({ error: "Transaction Failed" }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}
