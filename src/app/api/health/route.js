import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";

export async function GET() {
  try {
    const connections = await getProviderConnections();
    const activeCount = connections.filter(c => c.testStatus === "active").length;

    return NextResponse.json({
      status: "ok",
      service: "zippymesh",
      uptime: process.uptime(),
      providersConfigured: connections.length,
      providersActive: activeCount,
      timestamp: new Date().toISOString(),
      apiVersion: "v1"
    });
  } catch (error) {
    console.error("[health] Error:", error.message);
    return NextResponse.json(
      {
        status: "error",
        service: "zippymesh",
        message: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
