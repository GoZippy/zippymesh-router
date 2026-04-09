import { NextResponse } from "next/server";
import { listTeamMembers, addTeamMember, removeTeamMember } from "@/lib/localDb.js";

export async function GET(request, { params }) {
  try {
    const members = listTeamMembers(params.teamId);
    return NextResponse.json({ members });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { userIdentifier, role = 'viewer' } = await request.json();
    if (!userIdentifier) return NextResponse.json({ error: "userIdentifier is required" }, { status: 400 });
    if (!['admin', 'operator', 'viewer'].includes(role)) {
      return NextResponse.json({ error: "role must be admin, operator, or viewer" }, { status: 400 });
    }
    addTeamMember({ teamId: params.teamId, userIdentifier, role });
    return NextResponse.json({ teamId: params.teamId, userIdentifier, role }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { searchParams } = new URL(request.url);
    const userIdentifier = searchParams.get("user");
    if (!userIdentifier) return NextResponse.json({ error: "user query param required" }, { status: 400 });
    removeTeamMember(params.teamId, userIdentifier);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
