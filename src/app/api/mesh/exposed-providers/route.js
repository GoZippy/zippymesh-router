import { NextResponse } from "next/server";
import { getMeshExposedProviders, setMeshExposedProviders } from "@/lib/localDb.js";
import { getProviderNodes } from "@/models";

const SIDECAR_URL = process.env.SIDE_CAR_URL || "http://localhost:9480";

export async function GET() {
  try {
    const exposed = await getMeshExposedProviders();
    return NextResponse.json({ exposed });
  } catch (error) {
    console.error("Error fetching exposed providers:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { exposed } = body;

    if (!Array.isArray(exposed)) {
      return NextResponse.json({ error: "exposed must be an array" }, { status: 400 });
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
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
