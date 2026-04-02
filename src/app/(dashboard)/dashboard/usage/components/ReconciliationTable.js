"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "@/shared/components/Card";
import { formatRequestError, safeFetchJson } from "@/shared/utils";

function statusClass(status) {
  if (status === "aligned") return "text-green-600 dark:text-green-400";
  if (status === "minor_variance") return "text-yellow-600 dark:text-yellow-400";
  if (status === "insufficient_data") return "text-text-muted";
  return "text-red-600 dark:text-red-400";
}

export default function ReconciliationTable() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState("provider");
  const [sortDirection, setSortDirection] = useState("asc");

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await safeFetchJson("/api/usage/reconciliation?windowHours=168", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(formatRequestError("Failed to load reconciliation", response, "Failed to load reconciliation"));
        }
        setRows(response.data?.rows || []);
      } catch (err) {
        setError(err.message || "Failed to load reconciliation");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const sortedRows = useMemo(() => {
    const next = [...rows];
    next.sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      if (typeof left === "number" && typeof right === "number") {
        return sortDirection === "asc" ? left - right : right - left;
      }
      const leftText = String(left ?? "").toLowerCase();
      const rightText = String(right ?? "").toLowerCase();
      if (leftText === rightText) return 0;
      const textCompare = leftText < rightText ? -1 : 1;
      return sortDirection === "asc" ? textCompare : -textCompare;
    });
    return next;
  }, [rows, sortKey, sortDirection]);

  const setSort = (nextKey) => {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  };

  const exportCsv = () => {
    const header = [
      "provider",
      "ourTokens",
      "providerTokens",
      "tokenRatio",
      "ourExpectedCostUsd",
      "providerReportedCostUsd",
      "costRatio",
      "status",
      "signals",
    ];
    const lines = [
      header.join(","),
      ...sortedRows.map((row) => [
        row.provider,
        row.ourTokens || 0,
        row.providerTokens || 0,
        row.tokenRatio || 0,
        row.ourExpectedCostUsd || 0,
        row.providerReportedCostUsd || 0,
        row.costRatio || 0,
        row.status || "",
        (row.signals || []).join("|"),
      ].map((value) => `"${String(value).replace(/"/g, "\"\"")}"`).join(",")),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `usage-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Card padding="lg">Loading reconciliation data...</Card>;
  if (error) return <Card padding="lg">Failed to load reconciliation: {error}</Card>;
  if (!rows.length) return <Card padding="lg">No reconciliation data yet.</Card>;

  return (
    <Card padding="none">
      <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Usage & Billing Reconciliation</h3>
          <p className="text-sm text-text-muted">
            Compare router-counted usage/cost against provider-reported values.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="text-xs px-3 py-1.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-text-main">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 text-xs uppercase text-text-muted">
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("provider")}>Provider</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("ourTokens")}>Our Tokens</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("providerTokens")}>Provider Tokens</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("tokenRatio")}>Token Ratio</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("ourExpectedCostUsd")}>Our Cost (USD)</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("providerReportedCostUsd")}>Provider Cost (USD)</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("costRatio")}>Cost Ratio</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("status")}>Status</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("signals")}>Signals</button></th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={`${row.provider}:${row.connectionId || "none"}`} className="border-b border-black/5 dark:border-white/5">
                <td className="px-4 py-3 capitalize">{row.provider}</td>
                <td className="px-4 py-3">{Number(row.ourTokens || 0).toLocaleString()}</td>
                <td className="px-4 py-3">{Number(row.providerTokens || 0).toLocaleString()}</td>
                <td className="px-4 py-3">{row.tokenRatio || 0}</td>
                <td className="px-4 py-3">{row.ourExpectedCostUsd || 0}</td>
                <td className="px-4 py-3">{row.providerReportedCostUsd || 0}</td>
                <td className="px-4 py-3">{row.costRatio || 0}</td>
                <td className={`px-4 py-3 font-medium ${statusClass(row.status)}`}>{row.status}</td>
                <td className="px-4 py-3">{(row.signals || []).join(", ") || "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

