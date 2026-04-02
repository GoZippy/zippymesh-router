import { NextResponse } from "next/server";
import { getDb, getProviderConnectionById, updatePricing } from "@/lib/localDb";
import { registerModel } from "@/lib/modelRegistry.js";
import { __internal } from "@/lib/providers/sync.js";

function normalizeBaseUrl(input) {
    const trimmed = (input || "").trim().replace(/\/+$/, "");
    if (!trimmed) return null;
    return trimmed;
}

async function fetchKiroModels({ baseUrl, token }) {
    const url = `${baseUrl}/models`;
    const headers = { Accept: "application/json" };

    // Kiro’s gateway supports both Bearer token and anonymous (per their gateway code)
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Kiro models fetch failed: ${res.status} ${res.statusText} ${text}`);
    }

    const json = await res.json();

    // OpenRouter models response shape: { data: [...] }
    // We store the raw list plus a normalized map keyed by id.
    const list = Array.isArray(json?.data) ? json.data : [];
    const map = {};
    for (const m of list) {
        if (m?.id) map[m.id] = m;
    }

    return { list, map };
}

export async function POST(req) {
    try {
        const body = await req.json().catch(() => ({}));

        // You can pass:
        // - nodeId: if you store provider node records and want to attach models to that node
        // - baseUrl/apiKey: override for this call
        const { connectionId, nodeId, baseUrl: baseUrlIn, apiKey: apiKeyIn } = body || {};

        const db = await getDb();

        // Find Kiro node by id or by matching baseUrl if you want auto-discovery
        let node = null;
        if (nodeId && Array.isArray(db.data.providerNodes)) {
            node = db.data.providerNodes.find((n) => n.id === nodeId);
        }

        const baseUrl =
            normalizeBaseUrl(baseUrlIn) ||
            normalizeBaseUrl(node?.baseUrl) ||
            "https://api.kiro.ai/api/openrouter";

        let token = (apiKeyIn || "").trim();
        if (connectionId) {
            const connection = await getProviderConnectionById(connectionId);
            if (connection)
                token = (connection.accessToken || connection.apiKey || "").trim() || token;
        }
        if (!token && node?.apiKey) token = (node.apiKey || "").trim();

        const models = await fetchKiroModels({ baseUrl, token });

        const { normalizeModelRecord, normalizePricingFromModel } = __internal;
        const mergedPricing = { kiro: {} };
        let registeredCount = 0;
        for (const raw of models.list) {
            const normalized = normalizeModelRecord("kiro", raw);
            if (!normalized) continue;
            const pricingResult = normalizePricingFromModel("kiro", normalized.modelId, raw);
            if (pricingResult?.pricing) {
                mergedPricing.kiro[normalized.modelId] = pricingResult.pricing;
                normalized.inputPrice = pricingResult.pricing.input ?? 0;
                normalized.outputPrice = pricingResult.pricing.output ?? 0;
            }
            await registerModel(normalized);
            registeredCount += 1;
        }
        if (Object.keys(mergedPricing.kiro).length > 0) await updatePricing(mergedPricing);

        db.data.cachedModels ??= {};
        db.data.cachedModels.kiro ??= {};
        db.data.cachedModels.kiro[baseUrl] = {
            fetchedAt: new Date().toISOString(),
            count: models.list.length,
            list: models.list,
            map: models.map,
        };

        await db.write();

        return NextResponse.json({
            ok: true,
            baseUrl,
            fetchedAt: db.data.cachedModels.kiro[baseUrl].fetchedAt,
            count: models.list.length,
            registeredToRegistry: registeredCount,
        });
    } catch (err) {
        return NextResponse.json(
            { ok: false, error: err?.message || String(err) },
            { status: 500 },
        );
    }
}

