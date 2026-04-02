
import { NextResponse } from "next/server";
import { getRoutingPlaybookById } from "@/models";
import { apiError } from "@/lib/apiErrors.js";

export async function GET(request, { params }) {
  try {
    const { id } = params;
    const playbook = await getRoutingPlaybookById(id);
    if (!playbook) {
      return apiError(request, 404, "Playbook not found");
    }
    const filename = `playbook-${playbook.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
    return new Response(JSON.stringify(playbook, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return apiError(request, 500, "Failed to export playbook");
  }
}
