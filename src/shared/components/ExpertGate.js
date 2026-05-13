"use client";

import { useExpertMode } from "@/shared/hooks/useExpertMode";

export default function ExpertGate({ children, featureName = "this feature" }) {
  const { isExpert, setExpert } = useExpertMode();

  if (isExpert) return children;

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
        <span className="material-symbols-outlined text-[32px]">developer_mode</span>
      </div>
      <h2 className="text-xl font-semibold mb-2">Expert Mode Required</h2>
      <p className="text-text-muted mb-6 max-w-md">
        {featureName} is only available in Expert Mode. Enable it to access advanced developer and network tools.
      </p>
      <button
        onClick={() => setExpert(true)}
        className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors"
      >
        Enable Expert Mode
      </button>
    </div>
  );
}
