"use client";

import { useState, Suspense } from "react";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import ProviderLimits from "./components/ProviderLimits";
import ProviderUsageHub from "./components/ProviderUsageHub";
import ReconciliationTable from "./components/ReconciliationTable";
import ProviderModelsTable from "./components/ProviderModelsTable";

export default function UsagePage() {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-6xl mx-auto w-full">
      <SegmentedControl
        options={[
          { value: "overview", label: "Overview" },
          { value: "hub", label: "Provider Hub" },
          { value: "models", label: "Models & Pricing" },
          { value: "logs", label: "Logger" },
          { value: "limits", label: "Limits" },
          { value: "reconciliation", label: "Reconciliation" },
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
    </div>
  );
}
