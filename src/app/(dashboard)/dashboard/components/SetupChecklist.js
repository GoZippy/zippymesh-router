"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import { safeFetchJson } from "@/shared/utils";

const DISMISS_KEY = "zmlr_setup_dismissed";

export default function SetupChecklist() {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(true); // Start hidden, reveal after check
  const [celebrating, setCelebrating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const isDismissed = typeof window !== "undefined" && localStorage.getItem(DISMISS_KEY) === "true";
    if (isDismissed) return; // Don't fetch if dismissed

    safeFetchJson("/api/setup/status").then(res => {
      if (res.ok && res.data) {
        setStatus(res.data);
        if (!res.data.allDone) {
          setDismissed(false);
        }
      }
    }).catch(() => {});
  }, []);

  // Watch for allDone
  useEffect(() => {
    if (status?.allDone && !dismissed) {
      setCelebrating(true);
      setTimeout(() => {
        setDismissed(true);
        if (typeof window !== "undefined") {
          localStorage.setItem(DISMISS_KEY, "true");
        }
      }, 3000);
    }
  }, [status?.allDone]);

  if (dismissed || !status) return null;

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(DISMISS_KEY, "true");
    }
  };

  return (
    <Card className={`mb-4 border-2 ${celebrating ? "border-green-400 dark:border-green-600" : "border-primary/30"}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">
            {celebrating ? "celebration" : "rocket_launch"}
          </span>
          <h3 className="font-semibold text-sm">
            {celebrating ? "You're all set!" : "Get Started"}
          </h3>
          <span className="text-xs text-text-muted bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            {status.completedCount}/{status.steps.length}
          </span>
        </div>
        <button onClick={handleDismiss} className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted">
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-gray-100 dark:bg-white/10 rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${(status.completedCount / status.steps.length) * 100}%` }}
        />
      </div>

      <div className="flex flex-col gap-2">
        {status.steps.map(step => (
          <div key={step.id} className={`flex items-center justify-between gap-3 py-1 ${step.done ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-2">
              <span className={`material-symbols-outlined text-[18px] ${step.done ? "text-green-500" : "text-text-muted"}`}>
                {step.done ? "check_circle" : "radio_button_unchecked"}
              </span>
              <span className={`text-sm ${step.done ? "line-through text-text-muted" : ""}`}>{step.label}</span>
            </div>
            {!step.done && (
              <Button size="sm" variant="secondary" onClick={() => router.push(step.ctaPath)}>
                Go
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
