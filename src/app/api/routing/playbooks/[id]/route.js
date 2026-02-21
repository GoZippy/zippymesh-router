
import { NextResponse } from "next/server";
import { updateRoutingPlaybook, deleteRoutingPlaybook } from "@/models";

// PUT /api/routing/playbooks/[id] - Update playbook
export async function PUT(request, { params }) {
    try {
        const { id } = await params;
        const body = await request.json();

        const updated = await updateRoutingPlaybook(id, body);
        if (!updated) {
            return NextResponse.json({ error: "Playbook not found" }, { status: 404 });
        }

        return NextResponse.json({ playbook: updated });
    } catch (error) {
        console.log("Error updating playbook:", error);
        return NextResponse.json({ error: "Failed to update playbook" }, { status: 500 });
    }
}

// DELETE /api/routing/playbooks/[id] - Delete playbook
export async function DELETE(request, { params }) {
    try {
        const { id } = await params;
        const success = await deleteRoutingPlaybook(id);

        if (!success) {
            return NextResponse.json({ error: "Playbook not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.log("Error deleting playbook:", error);
        return NextResponse.json({ error: "Failed to delete playbook" }, { status: 500 });
    }
}
