import { NextResponse } from "next/server";
import { listOrganizations, createOrganization, getOrganization } from "@/lib/localDb.js";

export async function GET() {
  try {
    const orgs = listOrganizations();
    return NextResponse.json({ organizations: orgs });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { name, slug, plan } = await request.json();
    if (!name || !slug) return NextResponse.json({ error: "name and slug are required" }, { status: 400 });
    if (getOrganization(slug)) return NextResponse.json({ error: "Slug already exists" }, { status: 409 });
    const id = createOrganization({ name, slug, plan });
    return NextResponse.json({ id, name, slug, plan }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
