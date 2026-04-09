"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "@/shared/components/Card";
import { formatRequestError, safeFetchJson } from "@/shared/utils";

function formatTime(value) {
  if (!value) return "now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";
  return date.toLocaleString();
}

function statusBadge(status) {
  if (status === "available") return "text-green-600 dark:text-green-400";
  if (status === "cooldown") return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

export default function ProviderUsageHub() {
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
        const response = await safeFetchJson("/api/usage/limits", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(formatRequestError("Failed to fetch usage limits", response, "Failed to fetch usage limits"));
        }
        setRows(response.data?.connections || []);
      } catch (err) {
        setError(err.message || "Failed to fetch usage limits");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const tableRows = useMemo(() => {
    const mapped = rows.map((row) => {
      const totalLimit = row.buckets.reduce((sum, bucket) => sum + (Number(bucket.limit) || 0), 0);
      const totalUsed = row.buckets.reduce((sum, bucket) => sum + (Number(bucket.used) || 0), 0);
      const totalRemaining = row.buckets.reduce((sum, bucket) => {
        if (bucket.remaining === null || bucket.remaining === undefined) return sum;
        return sum + Number(bucket.remaining || 0);
      }, 0);
      return {
        ...row,
        totalLimit,
        totalUsed,
        totalRemaining,
      };
    });

    const sorted = [...mapped].sort((a, b) => {
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

    return sorted;
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
      "accountName",
      "tier",
      "status",
      "totalUsed",
      "totalLimit",
      "totalRemaining",
      "availableAgainAt"
    ];
    const lines = [
      header.join(","),
      ...tableRows.map((row) => [
        row.provider,
        row.accountName || "",
        row.tier || "",
        row.status || "",
        row.totalUsed,
        row.totalLimit,
        row.totalRemaining,
        row.availableAgainAt || ""
      ]
        .map((value) => `"${String(value).replace(/"/g, "\"\"")}"`)
        .join(","))
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `provider-usage-hub-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <Card padding="lg">Loading provider usage hub...</Card>;
  }

  if (error) {
    return <Card padding="lg">Failed to load provider usage hub: {error}</Card>;
  }

  if (!tableRows.length) {
    return <Card padding="lg">No enabled providers found.</Card>;
  }

  return (
    <Card padding="none">
      <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Provider & Usage Hub</h3>
          <p className="text-sm text-text-muted">
            Routing uses this live rate-limit and cooldown data to avoid unavailable providers.
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
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 text-xs uppercase text-text-muted">
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("provider")}>Provider</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("accountName")}>Account</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("tier")}>Tier</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("status")}>Status</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("totalUsed")}>Usage</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("totalLimit")}>Limit</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("totalRemaining")}>Remaining</button></th>
              <th className="px-4 py-3"><button type="button" onClick={() => setSort("availableAgainAt")}>Available Again</button></th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={row.connectionId} className="border-b border-black/5 dark:border-white/5">
                <td className="px-4 py-3 capitalize">{row.provider}</td>
                <td className="px-4 py-3">{row.accountName}</td>
                <td className="px-4 py-3">{row.tier || "unknown"}</td>
                <td className={`px-4 py-3 font-medium ${statusBadge(row.status)}`}>{row.status}</td>
                <td className="px-4 py-3">{row.totalUsed.toLocaleString()}</td>
                <td className="px-4 py-3">{row.totalLimit > 0 ? row.totalLimit.toLocaleString() : "dynamic"}</td>
                <td className="px-4 py-3">{row.totalRemaining.toLocaleString()}</td>
                <td className="px-4 py-3">{formatTime(row.availableAgainAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

