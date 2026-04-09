import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { getUsageHistory } from "@/lib/usageDb.js";

/**
 * GET /api/usage/export
 * Export usage data for bill validation (CSV or JSON)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "json";
    const provider = searchParams.get("provider");
    const days = parseInt(searchParams.get("days") || "30", 10);
    const limit = parseInt(searchParams.get("limit") || "1000", 10);

    const since = new Date();
    since.setDate(since.getDate() - days);

    const history = await getUsageHistory({
      provider,
      since: since.toISOString(),
      limit,
    });

    // Map to export format (anonymized, no API keys or sensitive data)
    const exportData = history.map((record) => ({
      timestamp: record.timestamp,
      provider: record.provider,
      model: record.model,
      tier: record.tierAtRequest || "default",
      inputTokens: record.ourPromptTokens || 0,
      outputTokens: record.ourCompletionTokens || 0,
      expectedCostUsd: record.ourExpectedCostUsd || 0,
      reportedCostUsd: record.providerReportedCostUsd || 0,
      varianceUsd:
        (record.providerReportedCostUsd || 0) - (record.ourExpectedCostUsd || 0),
      status: record.status || "unknown",
    }));

    if (format === "csv") {
      const headers = [
        "timestamp",
        "provider",
        "model",
        "tier",
        "inputTokens",
        "outputTokens",
        "expectedCostUsd",
        "reportedCostUsd",
        "varianceUsd",
        "status",
      ];

      const csvRows = [headers.join(",")];
      for (const row of exportData) {
        csvRows.push(
          headers
            .map((h) => {
              const val = row[h];
              if (typeof val === "string" && val.includes(",")) {
                return `"${val}"`;
              }
              return val;
            })
            .join(",")
        );
      }

      return new NextResponse(csvRows.join("\n"), {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="zippymesh-usage-export-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      periodDays: days,
      recordCount: exportData.length,
      records: exportData,
    });
  } catch (error) {
    console.error("Error exporting usage:", error);
    return apiError(request, 500, "Failed to export usage");
  }
}
