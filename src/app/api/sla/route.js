import { NextResponse } from "next/server";
import { getSlaStats, getSlaPctLatency, getSlaConfig, upsertSlaConfig, enableProviderSla, getDisabledProviders } from "@/lib/localDb.js";
import { generateWeeklySlaReport } from "@/lib/slaMonitor.js";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get("hours") || "24");
    const provider = searchParams.get("provider");
    const report = searchParams.get("report");

    if (report === "weekly") {
      return NextResponse.json(generateWeeklySlaReport());
    }

    const stats = getSlaStats({ provider, hours });
    const disabled = getDisabledProviders();

    // Enrich with P95 and config
    const enriched = stats.map(s => ({
      ...s,
      p95LatencyMs: getSlaPctLatency({ provider: s.provider, pct: 95, hours }),
      config: getSlaConfig(s.provider),
      isDisabled: disabled.includes(s.provider),
    }));

    return NextResponse.json({ stats: enriched, disabledProviders: disabled });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { provider, action, ...config } = body;
    if (!provider) return NextResponse.json({ error: "provider is required" }, { status: 400 });

    if (action === "enable") {
      enableProviderSla(provider);
      return NextResponse.json({ ok: true, provider, action: "enabled" });
    }

    upsertSlaConfig({
      provider,
      targetUptimePct: config.targetUptimePct,
      targetP95LatencyMs: config.targetP95LatencyMs,
      autoDisable: config.autoDisable,
      breachWindowMinutes: config.breachWindowMinutes,
    });
    return NextResponse.json({ ok: true, provider });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
