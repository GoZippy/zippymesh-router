
import { NextResponse } from "next/server";
import { getRoutingPlaybooks, createRoutingPlaybook } from "@/models";

// GET /api/routing/playbooks - List all playbooks
export async function GET() {
    try {
        const playbooks = await getRoutingPlaybooks();
        return NextResponse.json({ playbooks });
    } catch (error) {
        console.log("Error fetching playbooks:", error);
        return NextResponse.json({ error: "Failed to fetch playbooks" }, { status: 500 });
    }
}

// POST /api/routing/playbooks - Create new playbook
export async function POST(request) {
    try {
        const body = await request.json();
        const { name, description, rules, isActive, priority } = body;

        if (!name) {
            return NextResponse.json({ error: "Name is required" }, { status: 400 });
        }

        const newPlaybook = await createRoutingPlaybook({
            name,
            description,
            rules: rules || [],
            isActive: isActive !== undefined ? isActive : true,
            priority: priority || 0,
        });

        return NextResponse.json({ playbook: newPlaybook }, { status: 201 });
    } catch (error) {
        console.log("Error creating playbook:", error);
        return NextResponse.json({ error: "Failed to create playbook" }, { status: 500 });
    }
}
