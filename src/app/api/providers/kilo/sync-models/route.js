import { NextResponse } from "next/server";
import { getDb } from "@/lib/localDb";

function normalizeBaseUrl(input) {
    const trimmed = (input || "").trim().replace(/\/+$/, "");
    if (!trimmed) return null;
    return trimmed;
}

async function fetchKiloModels({ baseUrl, apiKey }) {
    const url = `${baseUrl}/models`;
    const headers = { Accept: "application/json" };

    // Kilo’s gateway supports both Bearer token and anonymous (per their gateway code)
    if (apiKey) {
        // OpenRouter-compatible endpoints generally accept Bearer token
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Kilo models fetch failed: ${res.status} ${res.statusText} ${text}`);
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
        const { nodeId, baseUrl: baseUrlIn, apiKey: apiKeyIn } = body || {};

        const db = await getDb();

        // Find Kilo node by id or by matching baseUrl if you want auto-discovery
        let node = null;
        if (nodeId && Array.isArray(db.data.providerNodes)) {
            node = db.data.providerNodes.find((n) => n.id === nodeId);
        }

        const baseUrl =
            normalizeBaseUrl(baseUrlIn) ||
            normalizeBaseUrl(node?.baseUrl) ||
            "https://api.kilo.ai/api/openrouter";

        // Prefer explicit apiKey; otherwise see if node/provider connection stores it
        const apiKey =
            (apiKeyIn || "").trim() ||
            (node?.apiKey || "").trim() ||
            ""; // allow empty if Kilo permits unauthenticated; if not, you’ll get 401

        const models = await fetchKiloModels({ baseUrl, apiKey });

        // Store in DB under a dedicated key. This avoids interfering with existing pricing/aliases.
        db.data.cachedModels ??= {};
        db.data.cachedModels.kilo ??= {};
        db.data.cachedModels.kilo[baseUrl] = {
            fetchedAt: new Date().toISOString(),
            count: models.list.length,
            list: models.list,
            map: models.map,
        };

        await db.write();

        return NextResponse.json({
            ok: true,
            baseUrl,
            fetchedAt: db.data.cachedModels.kilo[baseUrl].fetchedAt,
            count: models.list.length,
        });
    } catch (err) {
        return NextResponse.json(
            { ok: false, error: err?.message || String(err) },
            { status: 500 },
        );
    }
}
