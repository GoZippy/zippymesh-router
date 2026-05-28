import { NextResponse } from "next/server";
import { listVirtualKeys, createVirtualKey } from "@/lib/localDb.js";
import { apiError } from "@/lib/apiErrors.js";

// GET /api/virtual-keys - List all virtual keys (without key_hash)
export async function GET() {
  try {
    const keys = listVirtualKeys();
    return NextResponse.json({ keys: keys ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/virtual-keys - Create a new virtual key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, owner, team, project, monthlyTokenBudget, monthlyDollarBudget, rateLimitRpm } = body;
    if (!name?.trim()) {
      return apiError(request, 400, "Key name is required");
    }
    const result = createVirtualKey({
      name: name.trim(), owner, team, project,
      monthlyTokenBudget: monthlyTokenBudget ? parseInt(monthlyTokenBudget) : null,
      monthlyDollarBudget: monthlyDollarBudget ? parseFloat(monthlyDollarBudget) : null,
      rateLimitRpm: rateLimitRpm ? parseInt(rateLimitRpm) : null,
    });
    if (!result) {
      return apiError(request, 500, "Failed to create key");
    }
    return NextResponse.json({ key: result.rawKey, id: result.id, name: result.name, keyPrefix: result.keyPrefix }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
