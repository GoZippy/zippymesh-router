"use client";

import { useState, useEffect, Suspense } from "react";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import { formatRequestError, safeFetchJson } from "@/shared/utils";
import ProviderLimits from "./components/ProviderLimits";
import ProviderUsageHub from "./components/ProviderUsageHub";
import ReconciliationTable from "./components/ReconciliationTable";
import ProviderModelsTable from "./components/ProviderModelsTable";
import BillValidation from "./components/BillValidation";

export default function UsagePage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [isUpdatingDemoMode, setIsUpdatingDemoMode] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
      const response = await safeFetchJson("/api/settings", { credentials: "include" });
      if (response.ok) {
        setIsDemoMode(response.data?.isDemoMode === true);
      } else {
        console.error(formatRequestError("Failed to load demo mode", response));
        }
      } catch {
        // Ignore errors, default to false
      }
    };
    fetchSettings();
  }, []);

  const disableDemoMode = async () => {
    try {
      setIsUpdatingDemoMode(true);
      const response = await safeFetchJson("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDemoMode: false }),
      });

      if (response.ok) {
        setIsDemoMode(false);
      } else {
        console.error(formatRequestError("Failed to disable demo mode", response));
      }
    } catch {
      console.error("Failed to disable demo mode");
    } finally {
      setIsUpdatingDemoMode(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-6xl mx-auto w-full">
      {isDemoMode && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-sm">
          <span className="material-symbols-outlined text-lg">info</span>
          <span>
            <strong>Demo mode:</strong> Overview and Logger show sample data. Disable it here for real data.
          </span>
          <button
            onClick={disableDemoMode}
            disabled={isUpdatingDemoMode}
            className="ml-auto inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold tracking-wide uppercase transition hover:bg-amber-500/25 disabled:opacity-50"
          >
            {isUpdatingDemoMode ? "Disabling..." : "Disable Demo"}
          </button>
        </div>
      )}
      <SegmentedControl
        options={[
          { value: "overview", label: "Overview" },
          { value: "hub", label: "Provider Hub" },
          { value: "models", label: "Models & Pricing" },
          { value: "logs", label: "Logger" },
          { value: "limits", label: "Limits" },
          { value: "reconciliation", label: "Reconciliation" },
          { value: "billValidation", label: "Bill Validation" },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {/* Content */}
      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "hub" && (
        <Suspense fallback={<CardSkeleton />}>
          <ProviderUsageHub />
        </Suspense>
      )}
      {activeTab === "models" && (
        <Suspense fallback={<CardSkeleton />}>
          <ProviderModelsTable />
        </Suspense>
      )}
      {activeTab === "limits" && (
        <Suspense fallback={<CardSkeleton />}>
          <ProviderLimits />
        </Suspense>
      )}
      {activeTab === "reconciliation" && (
        <Suspense fallback={<CardSkeleton />}>
          <ReconciliationTable />
        </Suspense>
      )}
      {activeTab === "billValidation" && (
        <Suspense fallback={<CardSkeleton />}>
          <BillValidation />
        </Suspense>
      )}
    </div>
  );
}
