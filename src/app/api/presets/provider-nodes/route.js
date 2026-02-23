import { NextResponse } from "next/server";

export async function GET() {
    // Presets are UI helpers — they don't create anything by themselves.
    // The UI can POST these into /api/provider-nodes (or whatever CRUD route exists).
    const presets = [
        {
            id: "kilo-gateway",
            name: "Kilo Gateway (OpenRouter compatible)",
            description:
                "Routes to Kilo’s OpenRouter-compatible endpoint. Supports anonymous/free mode and authenticated Kilo tokens.",
            apiType: "openai-compatible",
            // Important: Kilo uses an OpenRouter-style surface
            baseUrl: "https://api.kilo.ai/api/openrouter",
            headers: {},
            // Suggested defaults for UX
            suggestedAuth: {
                mode: "apiKey", // ZippyMesh stores as apiKey in provider connection or node config
                placeholder: "Paste Kilo token OR use 'anonymous' for free/budget models",
                examples: ["anonymous"],
            },
            tags: ["kilo", "openrouter", "free/budget"],
        },
    ];

    return NextResponse.json({ presets });
}
