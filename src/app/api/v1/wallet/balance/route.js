import { NextResponse } from "next/server";
import { getNodeWallet, getSettings } from "@/lib/localDb.js";

export async function GET() {
    try {
        const settings = await getSettings();

        if (settings.isDemoMode) {
            return NextResponse.json({
                balance: 10240.0,
                currency: "ZIP",
                address: "ZIP-DEMO-NODE-123456789",
                symbol: "ZIPc"
            });
        }

        const wallet = await getNodeWallet();

        if (!wallet) {
            return NextResponse.json({
                balance: 0,
                currency: "ZIP",
                address: "No wallet linked",
                symbol: "ZIPc"
            });
        }

        return NextResponse.json({
            balance: wallet.balance || 0,
            address: wallet.address,
            name: wallet.name,
            currency: "ZIP",
            symbol: "ZIPc"
        });
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}
