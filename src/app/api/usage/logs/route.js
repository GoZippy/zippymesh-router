import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";
import { apiError } from "@/lib/apiErrors.js";

export async function GET(request) {
  try {
    const logs = await getRecentLogs(200);
    return NextResponse.json(logs);
  } catch (error) {
    console.error("Error fetching logs:", error);
    return apiError(request, 500, "Failed to fetch logs");
  }
}
