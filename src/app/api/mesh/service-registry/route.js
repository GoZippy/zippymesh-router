import { NextResponse } from "next/server";
import { getServiceRegistryConfig, setServiceRegistryConfig } from "@/lib/localDb.js";

export async function GET() {
  try {
    const config = await getServiceRegistryConfig();
    return NextResponse.json({ config });
  } catch (error) {
    console.error("Error fetching service registry config:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    await setServiceRegistryConfig(body);
    const config = await getServiceRegistryConfig();
    return NextResponse.json({ config });
  } catch (error) {
    console.error("Error saving service registry config:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
