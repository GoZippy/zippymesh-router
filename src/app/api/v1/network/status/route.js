import { NextResponse } from "next/server";
import { getSidecarUrl } from "@/lib/sidecar";

const SIDECAR_URL = getSidecarUrl();

export async function GET() {
    try {
        // Parallel fetch for info and peers
        const [infoRes, peersRes] = await Promise.allSettled([
            fetch(`${SIDECAR_URL}/node/info`, { cache: "no-store", next: { revalidate: 0 } }),
            fetch(`${SIDECAR_URL}/peers`, { cache: "no-store", next: { revalidate: 0 } })
        ]);

        let info = null;
        let peers = [];
        const errors = [];

        if (infoRes.status === "fulfilled") {
            if (infoRes.value.ok) {
                info = await infoRes.value.json();
            } else {
                errors.push(`info endpoint returned ${infoRes.value.status}`);
            }
        } else {
            errors.push(infoRes.reason?.message || "info endpoint request failed");
        }

        if (peersRes.status === "fulfilled") {
            if (peersRes.value.ok) {
                const peersPayload = await peersRes.value.json();
                peers = Array.isArray(peersPayload)
                    ? peersPayload
                    : Array.isArray(peersPayload?.peers)
                        ? peersPayload.peers
                        : [];
            } else {
                errors.push(`peers endpoint returned ${peersRes.value.status}`);
            }
        } else {
            errors.push(peersRes.reason?.message || "peers endpoint request failed");
        }

        return NextResponse.json({
            info,
            peers,
            ...(errors.length ? { error: errors.join(" | ") } : {}),
        });
    } catch (error) {
        console.error("Network Status API Error:", error);
        return NextResponse.json(
            { error: "Failed to fetch network status", details: error.message },
            { status: 500 }
        );
    }
}
