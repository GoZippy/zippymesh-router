

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

// VoidSpec config is usually in the workspace, but we can't easily find every workspace.
// However, we can provide a way to generate a command or a global config if it existed.
// Since VoidSpec uses VS Code settings, we can't easily write to them from a web server
// unless we use a specialized VS Code extension API or just provide the JSON for manual copy.

// For now, this API will serve as a placeholder or to provide the correct JSON structure.

export async function GET() {
    return NextResponse.json({
        message: "VoidSpec uses VS Code settings. Use the dashboard to see the recommended configuration.",
    });
}

export async function POST(request) {
    try {
        const { baseUrl, apiKey, model } = await request.json();

        // Return the recommended JSON for VS Code settings.json
        const recommendedSettings = {
            "voidspec.router.enabled": true,
            "voidspec.router.url": baseUrl,
            "voidspec.router.apiKey": apiKey || "sk_zippymesh",
            "voidspec.router.model": model,
            "voidspec.router.prompted": true
        };

        return NextResponse.json({
            success: true,
            recommendedSettings,
            message: "Recommended settings generated. Copy these to your VS Code settings.json"
        });
    } catch (error) {
        return NextResponse.json({ error: "Failed to generate settings" }, { status: 500 });
    }
}
