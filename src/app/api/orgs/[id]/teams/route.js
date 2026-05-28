import { NextResponse } from "next/server";
import { listTeams, createTeam, getOrganization } from "@/lib/localDb.js";

export async function GET(request, { params }) {
  try {
    const teams = listTeams(params.id);
    return NextResponse.json({ teams });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { name, slug } = await request.json();
    if (!name || !slug) return NextResponse.json({ error: "name and slug are required" }, { status: 400 });
    const id = createTeam({ orgId: params.id, name, slug });
    return NextResponse.json({ id, orgId: params.id, name, slug }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
