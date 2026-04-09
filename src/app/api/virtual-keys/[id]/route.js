import { NextResponse } from "next/server";
import { revokeVirtualKey } from "@/lib/localDb.js";
import { apiError } from "@/lib/apiErrors.js";

// DELETE /api/virtual-keys/[id] - Revoke a key
export async function DELETE(request, { params }) {
  try {
    const { id } = params;
    const ok = revokeVirtualKey(id);
    if (!ok) return apiError(request, 404, "Key not found");
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
