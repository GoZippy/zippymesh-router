import { NextResponse } from "next/server";
import { getAuditLog } from "@/lib/localDb.js";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");
    const actor = searchParams.get("actor");
    const action = searchParams.get("action");
    const hours = parseInt(searchParams.get("hours") || "168");
    const result = getAuditLog({ limit, offset, actor, action, hours });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
