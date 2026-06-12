import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { getDb } from "@/lib/localDb.js";
import { getUsageHistory } from "@/lib/usageDb.js";

const VARIANCE_THRESHOLD_PERCENT = 10;

/**
 * GET /api/usage/bill-validation
 * Compares expected costs vs provider-reported costs to detect discrepancies.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const days = parseInt(searchParams.get("days") || "30", 10);
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get usage history with cost data
    const history = await getUsageHistory({
      provider,
      since: since.toISOString(),
      limit,
    });

    // Filter to records that have both expected and reported costs
    const recordsWithCosts = history.filter(
      (r) =>
        r.ourExpectedCostUsd !== undefined &&
        r.ourExpectedCostUsd !== null &&
        r.ourExpectedCostUsd > 0
    );

    // Calculate totals and discrepancies
    const byProvider = new Map();

    for (const record of recordsWithCosts) {
      const providerKey = record.provider;

      if (!byProvider.has(providerKey)) {
        byProvider.set(providerKey, {
          provider: providerKey,
          totalRequests: 0,
          totalExpectedCostUsd: 0,
          totalReportedCostUsd: 0,
          totalVarianceUsd: 0,
          requestsWithVariance: 0,
          highVarianceRecords: [],
        });
      }

      const summary = byProvider.get(providerKey);
      summary.totalRequests++;
      summary.totalExpectedCostUsd += record.ourExpectedCostUsd || 0;
      summary.totalReportedCostUsd += record.providerReportedCostUsd || 0;

      // Check for variance
      const expected = record.ourExpectedCostUsd || 0;
      const reported = record.providerReportedCostUsd || 0;
      const variance = reported - expected;
      const variancePercent = expected > 0 ? (variance / expected) * 100 : 0;

      summary.totalVarianceUsd += variance;

      if (Math.abs(variancePercent) > VARIANCE_THRESHOLD_PERCENT) {
        summary.requestsWithVariance++;
        if (summary.highVarianceRecords.length < 10) {
          summary.highVarianceRecords.push({
            id: record.id,
            timestamp: record.timestamp,
            model: record.model,
            tier: record.tierAtRequest,
            expectedCostUsd: expected,
            reportedCostUsd: reported,
            varianceUsd: Number(variance.toFixed(6)),
            variancePercent: Number(variancePercent.toFixed(2)),
          });
        }
      }
    }

    // Build summary
    const providerSummaries = Array.from(byProvider.values()).map((summary) => ({
      ...summary,
      totalExpectedCostUsd: Number(summary.totalExpectedCostUsd.toFixed(6)),
      totalReportedCostUsd: Number(summary.totalReportedCostUsd.toFixed(6)),
      totalVarianceUsd: Number(summary.totalVarianceUsd.toFixed(6)),
      variancePercent:
        summary.totalExpectedCostUsd > 0
          ? Number(((summary.totalVarianceUsd / summary.totalExpectedCostUsd) * 100).toFixed(2))
          : 0,
      status: getVarianceStatus(summary.totalVarianceUsd, summary.totalExpectedCostUsd),
    }));

    // Overall totals
    const totals = providerSummaries.reduce(
      (acc, p) => ({
        totalRequests: acc.totalRequests + p.totalRequests,
        totalExpectedCostUsd: acc.totalExpectedCostUsd + p.totalExpectedCostUsd,
        totalReportedCostUsd: acc.totalReportedCostUsd + p.totalReportedCostUsd,
        totalVarianceUsd: acc.totalVarianceUsd + p.totalVarianceUsd,
      }),
      { totalRequests: 0, totalExpectedCostUsd: 0, totalReportedCostUsd: 0, totalVarianceUsd: 0 }
    );

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      periodDays: days,
      varianceThresholdPercent: VARIANCE_THRESHOLD_PERCENT,
      totals: {
        ...totals,
        variancePercent:
          totals.totalExpectedCostUsd > 0
            ? Number(((totals.totalVarianceUsd / totals.totalExpectedCostUsd) * 100).toFixed(2))
            : 0,
        status: getVarianceStatus(totals.totalVarianceUsd, totals.totalExpectedCostUsd),
      },
      providers: providerSummaries.sort((a, b) => Math.abs(b.totalVarianceUsd) - Math.abs(a.totalVarianceUsd)),
    });
  } catch (error) {
    console.error("Error validating bills:", error);
    return apiError(request, 500, "Failed to validate bills");
  }
}

function getVarianceStatus(varianceUsd, expectedUsd) {
  if (expectedUsd === 0) return "no_data";
  const percent = (varianceUsd / expectedUsd) * 100;

  if (percent > 20) return "high_overcharge";
  if (percent > 10) return "moderate_overcharge";
  if (percent > 0) return "slight_overcharge";
  if (percent < -20) return "high_undercharge";
  if (percent < -10) return "moderate_undercharge";
  if (percent < 0) return "slight_undercharge";
  return "ok";
}
