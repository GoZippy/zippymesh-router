import { NextResponse } from "next/server";
import { getMeshExposedProviders, setMeshExposedProviders } from "@/lib/localDb.js";
import { getProviderNodes } from "@/models";
import { getSidecarUrl, sidecarAuthHeaders } from "@/lib/sidecar";
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
      headers: { "Content-Type": "application/json", ...sidecarAuthHeaders() },
      body: JSON.stringify({ provider_ids: exposed, models }),
    }).catch(() => null);

    if (!res?.ok) {
      console.warn("Sidecar mesh endpoint not available; config saved locally.");
    }

    // Register this node as an on-chain provider so peers can discover it via
    // zippycoin_getProviders. Core requires a SIGNED registerProvider op, so we
    // go through the sidecar (which holds the ML-DSA key) — not an unsigned RPC.
    // Gated on MESH_PUBLIC_ENDPOINT so we never publish a bogus/unreachable
    // endpoint; set it to the URL peers should call for inference.
    const publicEndpoint = process.env.MESH_PUBLIC_ENDPOINT;
    if (publicEndpoint && exposed.length > 0) {
      try {
        const primary = models[0] || {};
        const reg = await fetch(`${SIDECAR_URL}/provider/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...sidecarAuthHeaders() },
          body: JSON.stringify({
            endpoint: publicEndpoint,
            model: primary.name || "",
            rate_zat_per_token: Number.isFinite(primary.rate_zat_per_token)
              ? primary.rate_zat_per_token
              : 1000,
          }),
        }).catch(() => null);
        if (!reg?.ok) {
          console.warn("On-chain provider registration skipped (sidecar/node unavailable).");
        }
      } catch (e) {
        console.warn("On-chain provider registration skipped:", e.message);
      }
    }

    return NextResponse.json({ exposed: await getMeshExposedProviders() });
  } catch (error) {
    console.error("Error setting exposed providers:", error);
    return apiError(request, 500, "Failed to save exposed providers");
  }
}
