import { NextResponse } from "next/server";
import { getRegistryModels } from "@/lib/modelRegistry";

/**
 * GET /api/marketplace/models - Get all models from the global registry
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const provider = searchParams.get("provider");
        const isFree = searchParams.get("isFree") === "true";
        const search = searchParams.get("search");

        const models = await getRegistryModels({
            provider,
            isFree: searchParams.has("isFree") ? isFree : undefined,
            search
        });

        return NextResponse.json({ models });
    } catch (error) {
        console.error("Error fetching marketplace models:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
