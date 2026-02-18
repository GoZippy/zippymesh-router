import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const sidecarUrl = process.env.SIDE_CAR_URL || 'http://localhost:9000';
        const res = await fetch(`${sidecarUrl}/health`, {
            method: "GET",
            // Short timeout to avoid blocking UI
            signal: AbortSignal.timeout(2000)
        });

        if (res.ok) {
            return NextResponse.json({ status: "connected", url: sidecarUrl });
        } else {
            return NextResponse.json({ status: "error", code: res.status }, { status: 502 });
        }
    } catch (error) {
        return NextResponse.json({ status: "disconnected", error: error.message }, { status: 503 });
    }
}
