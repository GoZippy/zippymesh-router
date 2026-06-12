"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import { Badge, Button, Select } from "@/shared/components";
import { formatRequestError, safeFetchJson } from "@/shared/utils";

function statusBadge(status) {
  const map = {
    ok: { variant: "success", label: "OK" },
    no_data: { variant: "secondary", label: "No Data" },
    slight_overcharge: { variant: "warning", label: "Slight Overcharge" },
    moderate_overcharge: { variant: "danger", label: "Moderate Overcharge" },
    high_overcharge: { variant: "danger", label: "High Overcharge" },
    slight_undercharge: { variant: "info", label: "Slight Undercharge" },
    moderate_undercharge: { variant: "info", label: "Moderate Undercharge" },
    high_undercharge: { variant: "info", label: "High Undercharge" },
  };
  const config = map[status] || { variant: "secondary", label: status };
  return <Badge variant={config.variant} size="sm">{config.label}</Badge>;
}

export default function BillValidation() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState("30");
  const [expandedProvider, setExpandedProvider] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await safeFetchJson(`/api/usage/bill-validation?days=${days}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(formatRequestError("Failed to load bill validation", response, "Failed to load bill validation"));
      }
      setData(response.data);
    } catch (err) {
      setError(err.message || "Failed to load bill validation");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [days]);

  const exportReport = async () => {
    window.open(`/api/usage/export?days=${days}&format=csv`, "_blank");
  };

  if (loading) return <Card padding="lg">Loading bill validation data...</Card>;
  if (error) return <Card padding="lg" className="text-red-500">Failed to load: {error}</Card>;
  if (!data) return <Card padding="lg">No data available.</Card>;

  return (
    <div className="flex flex-col gap-6">
      {/* Summary Card */}
      <Card padding="none">
        <div className="p-4 border-b border-border flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold">Bill Validation Summary</h3>
            <p className="text-sm text-text-muted">
              Compare your expected costs vs provider-reported costs to detect discrepancies.
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Select
              options={[
                { label: "Last 7 days", value: "7" },
                { label: "Last 30 days", value: "30" },
                { label: "Last 90 days", value: "90" },
              ]}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
            <Button variant="secondary" size="sm" onClick={exportReport}>
              Export CSV
            </Button>
          </div>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4">
          <div>
            <p className="text-sm text-text-muted">Total Requests</p>
            <p className="text-xl font-semibold">{data.totals.totalRequests.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-text-muted">Expected Cost</p>
            <p className="text-xl font-semibold">${data.totals.totalExpectedCostUsd.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm text-text-muted">Reported Cost</p>
            <p className="text-xl font-semibold">${data.totals.totalReportedCostUsd.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm text-text-muted">Variance</p>
            <p className={`text-xl font-semibold ${data.totals.totalVarianceUsd > 0 ? "text-red-500" : data.totals.totalVarianceUsd < 0 ? "text-green-500" : ""}`}>
              {data.totals.totalVarianceUsd > 0 ? "+" : ""}${data.totals.totalVarianceUsd.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-sm text-text-muted">Status</p>
            {statusBadge(data.totals.status)}
          </div>
        </div>
      </Card>

      {/* Provider Breakdown */}
      <Card padding="none">
        <div className="p-4 border-b border-border">
          <h3 className="text-lg font-semibold">Provider Breakdown</h3>
          <p className="text-sm text-text-muted">Click a provider to see high-variance requests.</p>
        </div>
        <div className="divide-y divide-border">
          {data.providers.length === 0 ? (
            <div className="p-4 text-text-muted">No provider data available.</div>
          ) : (
            data.providers.map((provider) => (
              <div key={provider.provider}>
                <button
                  className="w-full px-4 py-3 flex items-center gap-4 hover:bg-sidebar/30 transition-colors text-left"
                  onClick={() => setExpandedProvider(expandedProvider === provider.provider ? null : provider.provider)}
                >
                  <span className="capitalize font-medium flex-1">{provider.provider}</span>
                  <span className="text-sm text-text-muted">{provider.totalRequests} requests</span>
                  <span className="text-sm">
                    ${provider.totalExpectedCostUsd.toFixed(2)} → ${provider.totalReportedCostUsd.toFixed(2)}
                  </span>
                  <span className={`text-sm font-medium ${provider.totalVarianceUsd > 0 ? "text-red-500" : provider.totalVarianceUsd < 0 ? "text-green-500" : ""}`}>
                    {provider.totalVarianceUsd > 0 ? "+" : ""}${provider.totalVarianceUsd.toFixed(2)} ({provider.variancePercent}%)
                  </span>
                  {statusBadge(provider.status)}
                  <span className="material-symbols-outlined text-text-muted">
                    {expandedProvider === provider.provider ? "expand_less" : "expand_more"}
                  </span>
                </button>

                {expandedProvider === provider.provider && provider.highVarianceRecords.length > 0 && (
                  <div className="bg-sidebar/20 px-4 py-3 border-t border-border">
                    <p className="text-sm font-medium mb-2">High Variance Requests ({provider.requestsWithVariance} total)</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-text-muted text-xs uppercase">
                            <th className="py-1 pr-3 text-left">Time</th>
                            <th className="py-1 pr-3 text-left">Model</th>
                            <th className="py-1 pr-3 text-left">Tier</th>
                            <th className="py-1 pr-3 text-right">Expected</th>
                            <th className="py-1 pr-3 text-right">Reported</th>
                            <th className="py-1 text-right">Variance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {provider.highVarianceRecords.map((record) => (
                            <tr key={record.id} className="border-t border-border/50">
                              <td className="py-1 pr-3">{new Date(record.timestamp).toLocaleString()}</td>
                              <td className="py-1 pr-3">{record.model}</td>
                              <td className="py-1 pr-3">{record.tier || "—"}</td>
                              <td className="py-1 pr-3 text-right">${record.expectedCostUsd.toFixed(4)}</td>
                              <td className="py-1 pr-3 text-right">${record.reportedCostUsd.toFixed(4)}</td>
                              <td className={`py-1 text-right font-medium ${record.varianceUsd > 0 ? "text-red-500" : "text-green-500"}`}>
                                {record.varianceUsd > 0 ? "+" : ""}{record.variancePercent}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
