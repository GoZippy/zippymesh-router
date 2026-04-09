import { NextResponse } from "next/server";
import { getNodePricingConfig, setNodePricingConfig } from "@/lib/localDb.js";
import { getSidecarUrl } from "@/lib/sidecar";

const SIDECAR_URL = getSidecarUrl();

export async function GET() {
    try {
        const [nodeConfig, sidecarRes] = await Promise.all([
            getNodePricingConfig(),
            fetch(`${SIDECAR_URL}/node/pricing`, { cache: "no-store", next: { revalidate: 0 } }).catch(() => null),
        ]);

        const sidecarData = sidecarRes?.ok ? await sidecarRes.json() : null;
        const base = sidecarData || {
            base_price_per_token: 0.0001,
            min_price_per_token: 0.00005,
            congestion_multiplier: 1.0,
        };

        return NextResponse.json({
            ...base,
            pricing_mode: nodeConfig.pricing_mode || "simple",
            margin_percent: nodeConfig.margin_percent ?? 20,
            zip_usd_rate: nodeConfig.zip_usd_rate ?? 1,
            model_overrides: nodeConfig.model_overrides || {},
        });
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}

/** Scenario: 1M input + 500k output = 1.5M tokens for spotPriceUsd. */
const SPOT_SCENARIO_TOKENS = 1_500_000;

export async function POST(req) {
    try {
        const body = await req.json();
        let {
            base_price_per_token,
            min_price_per_token,
            congestion_multiplier,
            pricing_mode,
            margin_percent,
            zip_usd_rate,
            model_overrides,
        } = body;

        pricing_mode = pricing_mode ?? "simple";
        margin_percent = margin_percent ?? 20;
        zip_usd_rate = zip_usd_rate ?? 1;

        if (pricing_mode === "marketplace-anchored") {
            try {
                const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
                    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:20128");
                const spotRes = await fetch(`${baseUrl}/api/marketplace/spot-prices?limit=100`, { cache: "no-store" });
                const spotData = spotRes.ok ? await spotRes.json() : null;
                if (spotData?.models?.length) {
                    const margin = 1 + (margin_percent / 100);
                    const overrides = {};
                    for (const row of spotData.models) {
                        const pricePerToken = (row.spotPriceUsd || 0) / SPOT_SCENARIO_TOKENS;
                        const withMargin = pricePerToken * margin;
                        if (row.canonicalModelId && withMargin > 0) {
                            overrides[row.canonicalModelId] = { base: withMargin };
                        }
                    }
                    if (Object.keys(overrides).length) model_overrides = overrides;
                }
            } catch (_) {
                // keep existing model_overrides on fetch failure
            }
        }

        const sidecarPayload = {
            base_price_per_token: base_price_per_token ?? 0.0001,
            min_price_per_token: min_price_per_token ?? 0.00005,
            congestion_multiplier: congestion_multiplier ?? 1.0,
            pricing_mode: pricing_mode || undefined,
            margin_percent: margin_percent ?? undefined,
            zip_usd_rate: zip_usd_rate ?? undefined,
            model_overrides: model_overrides && Object.keys(model_overrides).length ? model_overrides : undefined,
        };

        const res = await fetch(`${SIDECAR_URL}/node/pricing`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sidecarPayload),
        });

        const sidecarData = res.ok ? await res.json() : sidecarPayload;

        await setNodePricingConfig({
            pricing_mode,
            margin_percent,
            zip_usd_rate,
            model_overrides: model_overrides ?? {},
        });

        return NextResponse.json({
            ...sidecarData,
            pricing_mode,
            margin_percent,
            zip_usd_rate,
            model_overrides: model_overrides ?? {},
        });
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}
