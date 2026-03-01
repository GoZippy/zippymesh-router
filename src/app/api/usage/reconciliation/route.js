import { NextResponse } from "next/server";
import { getUsageHistory } from "@/lib/usageDb.js";
import { getSettings } from "@/lib/localDb.js";

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function getStatus(maxVariancePct, thresholds) {
  if (maxVariancePct >= thresholds.critical) return "possible_overcharge";
  if (maxVariancePct >= thresholds.warn) return "check_discrepancy";
  if (maxVariancePct >= thresholds.minor) return "minor_variance";
  return "aligned";
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerFilter = searchParams.get("provider");
    const connectionFilter = searchParams.get("connectionId");
    const windowHours = Math.min(Math.max(Number(searchParams.get("windowHours") || 24), 1), 168);

    const [history, settings] = await Promise.all([getUsageHistory(), getSettings()]);
    const now = Date.now();
    const start = now - windowHours * 60 * 60 * 1000;

    const thresholds = {
      minor: Number(settings.minorVariancePct ?? 3),
      warn: Number(settings.warnVariancePct ?? 7),
      critical: Number(settings.criticalVariancePct ?? 12),
      minSampleSize: Number(settings.reconciliationMinSampleSize ?? 30),
    };

    const filtered = history.filter((entry) => {
      const ts = new Date(entry.timestamp).getTime();
      if (!Number.isFinite(ts) || ts < start) return false;
      if (providerFilter && entry.provider !== providerFilter) return false;
      if (connectionFilter && entry.connectionId !== connectionFilter) return false;
      return true;
    });

    const grouped = new Map();
    for (const entry of filtered) {
      const key = `${entry.provider || "unknown"}::${entry.connectionId || "unknown"}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          provider: entry.provider || "unknown",
          connectionId: entry.connectionId || null,
          ourTokens: 0,
          providerTokens: 0,
          ourExpectedCostUsd: 0,
          providerReportedCostUsd: 0,
          sampleSize: 0,
          tokenRatios: [],
          costRatios: [],
          signals: new Set(),
        });
      }
      const agg = grouped.get(key);

      const ourTokens = Number(entry.ourTotalTokens ?? entry.tokens?.total_tokens ?? 0);
      const providerTokens = Number(entry.providerTotalTokens ?? entry.providerTokens?.total_tokens ?? 0);
      const ourCost = Number(entry.ourExpectedCostUsd ?? entry.cost ?? 0);
      const providerCost = Number(entry.providerReportedCostUsd ?? 0);

      agg.ourTokens += Number.isFinite(ourTokens) ? ourTokens : 0;
      agg.providerTokens += Number.isFinite(providerTokens) ? providerTokens : 0;
      agg.ourExpectedCostUsd += Number.isFinite(ourCost) ? ourCost : 0;
      agg.providerReportedCostUsd += Number.isFinite(providerCost) ? providerCost : 0;
      agg.sampleSize += 1;

      if (ourTokens > 0 && providerTokens > 0) {
        const tokenRatio = providerTokens / ourTokens;
        agg.tokenRatios.push(tokenRatio);
        if (tokenRatio >= 1.05) agg.signals.add("consistent_overage");
        if (Math.abs(providerTokens - ourTokens) <= 100 && providerTokens > ourTokens) {
          agg.signals.add("rounding_pattern");
        }
      }

      if (ourCost > 0 && providerCost > 0) {
        const costRatio = providerCost / ourCost;
        agg.costRatios.push(costRatio);
      }
    }

    const rows = Array.from(grouped.values()).map((agg) => {
      const tokenRatio = agg.ourTokens > 0 ? agg.providerTokens / agg.ourTokens : 0;
      const costRatio = agg.ourExpectedCostUsd > 0 ? agg.providerReportedCostUsd / agg.ourExpectedCostUsd : 0;

      const tokenVariancePct = tokenRatio > 0 ? Math.abs(tokenRatio - 1) * 100 : 0;
      const costVariancePct = costRatio > 0 ? Math.abs(costRatio - 1) * 100 : 0;
      const maxVariancePct = Math.max(tokenVariancePct, costVariancePct);

      const insufficient = agg.sampleSize < thresholds.minSampleSize;
      const status = insufficient ? "insufficient_data" : getStatus(maxVariancePct, thresholds);
      const confidence = insufficient
        ? "low"
        : maxVariancePct >= thresholds.warn
          ? "high"
          : "medium";

      return {
        provider: agg.provider,
        connectionId: agg.connectionId,
        ourTokens: Math.round(agg.ourTokens),
        providerTokens: Math.round(agg.providerTokens),
        tokenRatio: Number(tokenRatio.toFixed(4)),
        ourExpectedCostUsd: Number(agg.ourExpectedCostUsd.toFixed(6)),
        providerReportedCostUsd: Number(agg.providerReportedCostUsd.toFixed(6)),
        costRatio: Number(costRatio.toFixed(4)),
        sampleSize: agg.sampleSize,
        confidence,
        status,
        signals: Array.from(agg.signals),
        stats: {
          tokenRatioMean: Number(mean(agg.tokenRatios).toFixed(4)),
          tokenRatioP95: Number(percentile(agg.tokenRatios, 0.95).toFixed(4)),
          costRatioMean: Number(mean(agg.costRatios).toFixed(4)),
          costRatioP95: Number(percentile(agg.costRatios, 0.95).toFixed(4)),
        },
        lastUpdated: new Date().toISOString(),
      };
    });

    return NextResponse.json({
      windowHours,
      thresholds,
      rows: rows.sort((a, b) => b.sampleSize - a.sampleSize),
    });
  } catch (error) {
    console.error("Error generating reconciliation report:", error);
    return NextResponse.json({ error: "Failed to calculate reconciliation" }, { status: 500 });
  }
}

