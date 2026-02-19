import { NextResponse } from "next/server";

// Using localhost for server-side fetch to Sidecar
const SIDECAR_URL = process.env.SIDE_CAR_URL || "http://localhost:8081";

export async function GET() {
    try {
        // Parallel fetch for info and peers
        const [infoRes, peersRes] = await Promise.all([
            fetch(`${SIDECAR_URL}/node/info`, { cache: "no-store", next: { revalidate: 0 } }),
            fetch(`${SIDECAR_URL}/peers`, { cache: "no-store", next: { revalidate: 0 } })
        ]);

        let info = null;
        if (infoRes.ok) {
            info = await infoRes.json();
        } else {
            console.error("Failed to fetch info from Sidecar:", infoRes.status);
        }

        let peers = [];
        if (peersRes.ok) {
            peers = await peersRes.json();
        } else {
            console.error("Failed to fetch peers from Sidecar:", peersRes.status);
        }

        return NextResponse.json({
            info: info,
            peers: peers
        });
    } catch (error) {
        console.error("Network Status API Error:", error);
        return NextResponse.json(
            { error: "Failed to fetch network status", details: error.message },
            { status: 500 }
        );
    }
}
