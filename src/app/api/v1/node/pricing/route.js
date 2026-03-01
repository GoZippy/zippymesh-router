import { NextResponse } from "next/server";
import { getNodePricingConfig, setNodePricingConfig } from "@/lib/localDb.js";

const SIDECAR_URL = process.env.SIDE_CAR_URL || "http://localhost:9480";

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

export async function POST(req) {
    try {
        const body = await req.json();
        const {
            base_price_per_token,
            min_price_per_token,
            congestion_multiplier,
            pricing_mode,
            margin_percent,
            zip_usd_rate,
            model_overrides,
        } = body;

        const sidecarPayload = {
            base_price_per_token: base_price_per_token ?? 0.0001,
            min_price_per_token: min_price_per_token ?? 0.00005,
            congestion_multiplier: congestion_multiplier ?? 1.0,
        };

        const res = await fetch(`${SIDECAR_URL}/node/pricing`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sidecarPayload),
        });

        const sidecarData = res.ok ? await res.json() : sidecarPayload;

        await setNodePricingConfig({
            pricing_mode: pricing_mode ?? "simple",
            margin_percent: margin_percent ?? 20,
            zip_usd_rate: zip_usd_rate ?? 1,
            model_overrides: model_overrides ?? {},
        });

        return NextResponse.json({
            ...sidecarData,
            pricing_mode: pricing_mode ?? "simple",
            margin_percent: margin_percent ?? 20,
            zip_usd_rate: zip_usd_rate ?? 1,
            model_overrides: model_overrides ?? {},
        });
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}
