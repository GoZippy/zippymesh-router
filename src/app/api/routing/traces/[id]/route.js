import { NextResponse } from "next/server";
import { getRequestTraceById, flagRequestTrace } from "@/lib/localDb.js";
import { apiError } from "@/lib/apiErrors.js";

export async function GET(request, { params }) {
  try {
    const { id } = params;
    const trace = getRequestTraceById(parseInt(id));
    if (!trace) return apiError(request, 404, "Trace not found");
    return NextResponse.json(trace);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = params;
    const body = await request.json();
    if (typeof body.flagged === "boolean") {
      flagRequestTrace(parseInt(id), body.flagged);
    }
    const trace = getRequestTraceById(parseInt(id));
    return NextResponse.json(trace);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
