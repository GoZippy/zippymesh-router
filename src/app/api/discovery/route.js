import { discoveryService } from "@/lib/discovery/localDiscovery";
import { NextResponse } from "next/server";

export async function POST(req) {
    try {
        const discovered = await discoveryService.scan();
        return NextResponse.json({
            success: true,
            count: discovered.length,
            nodes: discovered
        });
    } catch (error) {
        console.error("Discovery error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
