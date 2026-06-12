import { NextResponse } from "next/server";
import { purgeVirtualKeyData, listVirtualKeys, writeAuditLog } from "@/lib/localDb.js";

export async function POST(request) {
  try {
    const { keyId, confirm } = await request.json();
    if (!keyId) return NextResponse.json({ error: "keyId is required" }, { status: 400 });
    if (confirm !== true) return NextResponse.json({ error: "confirm: true is required to proceed with deletion" }, { status: 400 });

    purgeVirtualKeyData(keyId);
    writeAuditLog({
      action: 'gdpr_deletion_requested',
      resourceType: 'virtual_key',
      resourceId: keyId,
    });
    return NextResponse.json({ ok: true, message: "Data purged and key revoked" });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
