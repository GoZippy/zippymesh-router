import { NextResponse } from "next/server";

const SIDE_CAR_URL = process.env.SIDE_CAR_URL || "http://localhost:8081";

export async function GET() {
    try {
        const res = await fetch(`${SIDE_CAR_URL}/wallet/transactions`, {
            cache: "no-store",
            next: { revalidate: 0 },
        });

        if (!res.ok) {
            return NextResponse.json(
                { error: "Failed to fetch transactions from Sidecar" },
                { status: res.status }
            );
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Transactions API Error:", error);
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
