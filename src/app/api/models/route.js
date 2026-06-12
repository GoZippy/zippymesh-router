import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { getModelAliases, setModelAlias } from "@/models";
import { AI_MODELS } from "@/shared/constants/config";

// GET /api/models - Get models with aliases
export async function GET(request) {
  try {
    const modelAliases = await getModelAliases();
    
    const models = AI_MODELS.map((m) => {
      const fullModel = `${m.provider}/${m.model}`;
      return {
        ...m,
        fullModel,
        alias: modelAliases[fullModel] || m.model,
      };
    });

    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return apiError(request, 500, "Failed to fetch models");
  }
}

// PUT /api/models - Update model alias
export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return apiError(request, 400, "Model and alias required");
    }

    const modelAliases = await getModelAliases();

    // Check if alias already exists for different model
    const existingModel = Object.entries(modelAliases).find(
      ([key, val]) => val === alias && key !== model
    );

    if (existingModel) {
      return apiError(request, 400, "Alias already in use");
    }

    // Update alias
    await setModelAlias(model, alias);

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return apiError(request, 500, "Failed to update alias");
  }
}
