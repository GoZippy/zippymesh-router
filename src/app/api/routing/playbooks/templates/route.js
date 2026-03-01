import { NextResponse } from "next/server";
import { SMART_PLAYBOOK_TEMPLATES } from "@/shared/constants/defaults.js";
import { createRoutingPlaybook } from "@/lib/localDb.js";

export async function GET() {
  return NextResponse.json({ templates: SMART_PLAYBOOK_TEMPLATES });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { templateId, name, priority } = body;
    const template = SMART_PLAYBOOK_TEMPLATES.find((item) => item.id === templateId);
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const playbook = await createRoutingPlaybook({
      name: name || template.name,
      description: template.description,
      trigger: template.trigger,
      rules: template.rules,
      priority: Number(priority || 0),
      isActive: true,
    });

    return NextResponse.json({ playbook }, { status: 201 });
  } catch (error) {
    console.error("Error creating playbook from template:", error);
    return NextResponse.json({ error: "Failed to create playbook from template" }, { status: 500 });
  }
}

