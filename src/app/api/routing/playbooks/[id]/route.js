
import { NextResponse } from "next/server";
import { updateRoutingPlaybook, deleteRoutingPlaybook } from "@/models";
import { apiError } from "@/lib/apiErrors.js";

// PUT /api/routing/playbooks/[id] - Update playbook
export async function PUT(request, { params }) {
    try {
        const { id } = await params;
        const body = await request.json();

        const updated = await updateRoutingPlaybook(id, body);
        if (!updated) {
            return apiError(request, 404, "Playbook not found");
        }

        return NextResponse.json({ playbook: updated });
    } catch (error) {
        console.log("Error updating playbook:", error);
        return apiError(request, 500, "Failed to update playbook");
    }
}

// DELETE /api/routing/playbooks/[id] - Delete playbook
export async function DELETE(request, { params }) {
    try {
        const { id } = await params;
        const success = await deleteRoutingPlaybook(id);

        if (!success) {
            return apiError(request, 404, "Playbook not found");
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.log("Error deleting playbook:", error);
        return apiError(request, 500, "Failed to delete playbook");
    }
}
