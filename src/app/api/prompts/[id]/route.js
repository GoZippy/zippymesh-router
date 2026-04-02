import { NextResponse } from "next/server";
import { getPromptTemplate, updatePromptTemplate, deletePromptTemplate, incrementPromptUseCount } from "@/lib/localDb.js";
import { apiError } from "@/lib/apiErrors.js";

export async function GET(request, { params }) {
  const t = getPromptTemplate(params.id);
  if (!t) return apiError(request, 404, "Template not found");
  return NextResponse.json(t);
}

export async function PUT(request, { params }) {
  const body = await request.json();
  updatePromptTemplate(params.id, body);
  return NextResponse.json(getPromptTemplate(params.id));
}

export async function DELETE(request, { params }) {
  deletePromptTemplate(params.id);
  return NextResponse.json({ success: true });
}

export async function PATCH(request, { params }) {
  // For toggling favorite or incrementing use count
  const body = await request.json();
  if (body.increment_use) incrementPromptUseCount(params.id);
  else updatePromptTemplate(params.id, body);
  return NextResponse.json(getPromptTemplate(params.id));
}
