import { NextResponse } from "next/server";

const SIDECAR_URL = process.env.SIDE_CAR_URL || "http://localhost:8081";

export async function GET() {
    try {
        const res = await fetch(`${SIDECAR_URL}/wallet/balance`, {
            cache: "no-store",
            next: { revalidate: 0 },
        });

        if (!res.ok) {
            return NextResponse.json({ error: "Failed to fetch balance" }, { status: res.status });
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
