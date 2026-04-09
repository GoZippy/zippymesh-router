import { NextResponse } from "next/server";
import { getSidecarUrl } from "@/lib/sidecar";
import { apiError } from "@/lib/apiErrors.js";

const SIDECAR_URL = getSidecarUrl();

export async function POST(req) {
    try {
        const body = await req.json();
        const { multiaddr } = body;

        if (!multiaddr) {
            return apiError(req, 400, "Multiaddr is required");
        }

        const res = await fetch(`${SIDECAR_URL}/peers/connect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ multiaddr }),
        });

        if (!res.ok) {
            const errorText = await res.text();
            return apiError(req, res.status, `Sidecar Error: ${errorText}`);
        }

        return NextResponse.json({ success: true, message: "Connected to peer" });
    } catch (error) {
        console.error("Connect Peer API Error:", error);
        return apiError(req, 500, "Failed to connect to peer");
    }
}
