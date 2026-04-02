
import { NextResponse } from "next/server";
import { getRoutingPlaybooks, createRoutingPlaybook } from "@/models";
import { apiError } from "@/lib/apiErrors.js";

// GET /api/routing/playbooks - List all playbooks
export async function GET(request) {
    try {
        const playbooks = await getRoutingPlaybooks();
        return NextResponse.json({ playbooks });
    } catch (error) {
        console.log("Error fetching playbooks:", error);
        return apiError(request, 500, "Failed to fetch playbooks");
    }
}

// POST /api/routing/playbooks - Create new playbook
export async function POST(request) {
    try {
        const body = await request.json();
        const { name, description, rules, isActive, priority } = body;

        if (!name) {
            return apiError(request, 400, "Name is required");
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
        return apiError(request, 500, "Failed to create playbook");
    }
}
