import { NextResponse } from "next/server";
import { listPromptTemplates, createPromptTemplate } from "@/lib/localDb.js";
import { apiError } from "@/lib/apiErrors.js";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tag = searchParams.get("tag");
  const search = searchParams.get("search");
  return NextResponse.json({ templates: listPromptTemplates({ tag, search }) });
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.title?.trim() || !body.content?.trim()) {
      return apiError(request, 400, "title and content are required");
    }
    const id = createPromptTemplate(body);
    if (!id) return apiError(request, 500, "Failed to create template");
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
