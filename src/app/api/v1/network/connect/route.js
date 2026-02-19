import { NextResponse } from "next/server";

const SIDECAR_URL = process.env.SIDE_CAR_URL || "http://localhost:9000";

export async function POST(req) {
    try {
        const body = await req.json();
        const { multiaddr } = body;

        if (!multiaddr) {
            return NextResponse.json({ error: "Multiaddr is required" }, { status: 400 });
        }

        const res = await fetch(`${SIDECAR_URL}/peers/connect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ multiaddr }),
        });

        if (!res.ok) {
            const errorText = await res.text();
            return NextResponse.json({ error: `Sidecar Error: ${errorText}` }, { status: res.status });
        }

        return NextResponse.json({ success: true, message: "Connected to peer" });
    } catch (error) {
        console.error("Connect Peer API Error:", error);
        return NextResponse.json(
            { error: "Failed to connect to peer", details: error.message },
            { status: 500 }
        );
    }
}
