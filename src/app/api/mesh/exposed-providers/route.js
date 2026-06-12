import { NextResponse } from "next/server";
import { getMeshExposedProviders, setMeshExposedProviders } from "@/lib/localDb.js";
import { getProviderNodes } from "@/models";
import { getSidecarUrl } from "@/lib/sidecar";
import { apiError } from "@/lib/apiErrors";

const SIDECAR_URL = getSidecarUrl();

export async function GET(request) {
  try {
    const exposed = await getMeshExposedProviders();
    return NextResponse.json({ exposed });
  } catch (error) {
    console.error("Error fetching exposed providers:", error);
    return apiError(request, 500, "Failed to fetch exposed providers");
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { exposed } = body;

    if (!Array.isArray(exposed)) {
      return apiError(request, 400, "exposed must be an array");
    }

    await setMeshExposedProviders(exposed);

    const nodes = await getProviderNodes();
    const models = [];
    for (const id of exposed) {
      if (id.startsWith("openai-compatible-") || id.startsWith("anthropic-compatible-")) {
        const node = nodes.find((n) => n.id === id);
        if (node) {
          models.push({ name: node.prefix || "model", cost_per_token: 0.0001, quantization: "default" });
        }
      } else {
        models.push({ name: id, cost_per_token: 0, quantization: "local" });
      }
    }
    if (models.length === 0) {
      models.push({ name: "llama3", cost_per_token: 0.0001, quantization: "q4" });
    }

    const res = await fetch(`${SIDECAR_URL}/mesh/exposed-providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider_ids: exposed, models }),
    }).catch(() => null);

    if (!res?.ok) {
      console.warn("Sidecar mesh endpoint not available; config saved locally.");
    }

    return NextResponse.json({ exposed: await getMeshExposedProviders() });
  } catch (error) {
    console.error("Error setting exposed providers:", error);
    return apiError(request, 500, "Failed to save exposed providers");
  }
}
