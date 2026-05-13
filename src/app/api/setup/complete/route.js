import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { setFirstRunCompleted } from "@/lib/localDb";

export async function POST(request) {
  try {
    await setFirstRunCompleted();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(request, 500, err.message || "Setup completion failed");
  }
}
