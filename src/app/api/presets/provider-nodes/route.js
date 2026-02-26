import { NextResponse } from "next/server";

export async function GET() {
    // Presets are UI helpers — they don't create anything by themselves.
    // The UI can POST these into /api/provider-nodes (or whatever CRUD route exists).
    const presets = [
        {
            id: "kiro-gateway",
            name: "Kiro Gateway (OpenRouter compatible)",
            description:
                "Routes to Kiro’s OpenRouter-compatible endpoint. Supports anonymous/free mode and authenticated Kiro tokens.",
            apiType: "openai-compatible",
            // Important: Kiro uses an OpenRouter-style surface
            baseUrl: "https://api.kiro.ai/api/openrouter",
            headers: {},
            // Suggested defaults for UX
            suggestedAuth: {
                mode: "apiKey", // ZippyMesh stores as apiKey in provider connection or node config
                placeholder: "Paste Kiro token OR use 'anonymous' for free/budget models",
                examples: ["anonymous"],
            },
            tags: ["kiro", "openrouter", "free/budget"],
        },

    ];

    return NextResponse.json({ presets });
}
