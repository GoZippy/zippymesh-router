"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import { safeFetchJson, formatRequestError } from "@/shared/utils";

export default function LabsPage() {
  const [features, setFeatures] = useState([]);
  const [flags, setFlags] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [savingKey, setSavingKey] = useState(null);
  const [rowError, setRowError] = useState({});

  // Inline async fetch-on-mount (repo pattern; no memoized setState callback in
  // the effect body — satisfies react-hooks/set-state-in-effect).
  useEffect(() => {
    const run = async () => {
      const res = await safeFetchJson("/api/labs", { credentials: "include" });
      if (res.ok) {
        setFeatures(Array.isArray(res.data?.features) ? res.data.features : []);
        setFlags(res.data?.flags && typeof res.data.flags === "object" ? res.data.flags : {});
        setLoadError("");
      } else {
        setLoadError(formatRequestError("Failed to load experimental features", res));
      }
      setLoading(false);
    };
    run();
  }, []);

  const toggle = async (key, next) => {
    setSavingKey(key);
    setRowError((e) => ({ ...e, [key]: "" }));
    // optimistic
    setFlags((f) => ({ ...f, [key]: next }));
    const res = await safeFetchJson("/api/labs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ [key]: next }),
    });
    if (res.ok && res.data?.flags) {
      setFlags(res.data.flags);
    } else {
      setFlags((f) => ({ ...f, [key]: !next })); // revert
      setRowError((e) => ({ ...e, [key]: formatRequestError("Failed to save", res) }));
    }
    setSavingKey(null);
  };

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-4xl mx-auto w-full">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-main flex items-center gap-2">
          <span className="material-symbols-outlined">science</span> Labs
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Experimental features — off by default. Enabling one reveals its dashboard section.
          These capabilities are still being validated and may change or break between versions.
        </p>
      </div>

      <Card className="border-amber-300/40 bg-amber-50/40 dark:bg-amber-500/5">
        <div className="flex items-start gap-3 p-1">
          <span className="material-symbols-outlined text-amber-500">warning</span>
          <p className="text-sm text-text-muted">
            Experimental features (P2P mesh, marketplace, monetization, wallet, compute) are
            pre-release. Enabling them only shows the UI; the underlying network/chain layers are
            opt-in and not required to use the core router. Nothing here sends your data to a
            third party.
          </p>
        </div>
      </Card>

      {loading && <p className="text-sm text-text-muted">Loading…</p>}
      {loadError && (
        <div className="rounded-lg border border-red-300/40 bg-red-50/40 dark:bg-red-500/5 p-3 text-sm text-red-500">
          {loadError}
        </div>
      )}

      {!loading && !loadError && (
        <div className="flex flex-col gap-3">
          {features.map((f) => {
            const on = flags[f.key] === true;
            return (
              <Card key={f.key}>
                <div className="flex items-start justify-between gap-4 p-1">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text-main">{f.label}</span>
                      <Badge variant={on ? "success" : "default"}>{on ? "Enabled" : "Off"}</Badge>
                    </div>
                    <p className="text-xs text-text-muted max-w-xl">{f.description}</p>
                    {rowError[f.key] && (
                      <p className="text-xs text-red-500">{rowError[f.key]}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={savingKey === f.key}
                    onClick={() => toggle(f.key, !on)}
                    aria-pressed={on}
                    title={on ? "Disable" : "Enable"}
                    className={`mt-1 w-10 h-5 rounded-full transition-colors relative shrink-0 disabled:opacity-50 ${
                      on ? "bg-primary" : "bg-gray-300 dark:bg-white/20"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        on ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
