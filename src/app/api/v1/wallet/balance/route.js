import { NextResponse } from "next/server";
import { getProviderNodes } from "@/lib/localDb.js";
import { getWalletBalance } from "@/lib/sidecar.js";

export async function GET() {
    try {
        const balance = await getWalletBalance();
        const nodes = await getProviderNodes();
        const localNode = nodes.find(n => n.type === "local") || { id: "0xx-node-local" };

        return NextResponse.json({
            balance,
            address: `ZIP-${localNode.id.slice(0, 10).toUpperCase()}`,
            symbol: "ZIPc"
        });
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}
