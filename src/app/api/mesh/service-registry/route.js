import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { getServiceRegistryConfig, setServiceRegistryConfig } from "@/lib/localDb.js";

export async function GET(request) {
  try {
    const config = await getServiceRegistryConfig();
    return NextResponse.json({ config });
  } catch (error) {
    console.error("Error fetching service registry config:", error);
    return apiError(request, 500, "Failed to fetch");
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
    return apiError(request, 500, "Failed to save");
  }
}
