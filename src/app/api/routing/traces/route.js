import { NextResponse } from "next/server";
import { getRequestTraces } from "@/lib/localDb.js";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get("hours") || "24");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
    const offset = parseInt(searchParams.get("offset") || "0");
    const model = searchParams.get("model");
    const intent = searchParams.get("intent");

    const result = getRequestTraces({ hours, limit, offset, model, intent });
    return NextResponse.json(result ?? { traces: [], total: 0 });
  } catch (error) {
    console.error("[TracesAPI] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch traces", details: error.message },
      { status: 500 }
    );
  }
}
