"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import { safeFetchJson } from "@/shared/utils";
import ExpertGate from "@/shared/components/ExpertGate";

const SCENARIOS = [
  { id: "current", label: "Current Config", constraints: {} },
  { id: "free", label: "Free Only", constraints: { preferFree: true } },
  { id: "cheap", label: "Cost-Optimized", constraints: { maxCostPerMTokens: 1.0 } },
  { id: "local", label: "Local Only", constraints: { preferLocal: true } },
];

const COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#84cc16"];

function NumberInput({ label, value, onChange, min = 1, step = 1 }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-muted mb-1">{label}</label>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={e => onChange(Math.max(min, parseInt(e.target.value) || min))}
        className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm font-mono"
      />
    </div>
  );
}

export default function CostSimulatorPage() {
  const [requestsPerDay, setRequestsPerDay] = useState(500);
  const [avgInputTokens, setAvgInputTokens] = useState(800);
  const [avgOutputTokens, setAvgOutputTokens] = useState(400);
  const [activeScenario, setActiveScenario] = useState("current");
  const [maxCost, setMaxCost] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savedScenarios, setSavedScenarios] = useState([]);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("zmlr_cost_scenarios") || "[]") : [];
    setSavedScenarios(saved);
  }, []);

  const getConstraints = () => {
    const scenario = SCENARIOS.find(s => s.id === activeScenario);
    const base = scenario?.constraints || {};
    if (maxCost) base.maxCostPerMTokens = parseFloat(maxCost);
    return base;
  };

  const handleSimulate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await safeFetchJson("/api/routing/simulate-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestsPerDay,
          avgInputTokens,
          avgOutputTokens,
          constraints: getConstraints(),
        }),
      });
      if (res.ok) setResult(res.data);
    } finally {
      setLoading(false);
    }
  }, [requestsPerDay, avgInputTokens, avgOutputTokens, activeScenario, maxCost]);

  const handleSaveScenario = () => {
    const name = prompt("Scenario name:");
    if (!name) return;
    const newScenario = {
      name,
      requestsPerDay, avgInputTokens, avgOutputTokens,
      scenario: activeScenario, maxCost,
      savedAt: new Date().toISOString(),
    };
    const updated = [...savedScenarios, newScenario];
    setSavedScenarios(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem("zmlr_cost_scenarios", JSON.stringify(updated));
    }
  };

  const chartData = result?.breakdown?.slice(0, 8).map(m => ({
    name: (m.name || m.model).split("/").pop().slice(0, 20),
    cost: m.monthlyCost,
    isFree: m.isFree,
  })) || [];

  return (
    <ExpertGate featureName="Cost Simulator">
      <div className="flex flex-col gap-6 max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Cost Simulator</h1>
            <p className="text-sm text-text-muted mt-1">
              Project monthly costs across routing configurations before committing.
            </p>
          </div>
          {result && (
            <Button variant="secondary" size="sm" icon="bookmark" onClick={handleSaveScenario}>
              Save Scenario
            </Button>
          )}
        </div>

        {/* Inputs */}
        <Card>
          <h2 className="text-base font-semibold mb-4">Usage Profile</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <NumberInput label="Requests per Day" value={requestsPerDay} onChange={setRequestsPerDay} min={1} />
            <NumberInput label="Avg Input Tokens" value={avgInputTokens} onChange={setAvgInputTokens} min={1} />
            <NumberInput label="Avg Output Tokens" value={avgOutputTokens} onChange={setAvgOutputTokens} min={1} />
          </div>
          <p className="text-xs text-text-muted mb-3">
            Monthly: <strong>{(requestsPerDay * 30).toLocaleString()}</strong> requests ·{" "}
            <strong>{((requestsPerDay * 30 * (avgInputTokens + avgOutputTokens)) / 1e6).toFixed(1)}M</strong> total tokens
          </p>

          <h3 className="text-sm font-semibold mb-3">Scenario</h3>
          <div className="flex flex-wrap gap-2 mb-4">
            {SCENARIOS.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveScenario(s.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  activeScenario === s.id ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:text-text-main"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Max cost / 1M tokens (USD, optional)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={maxCost}
                onChange={e => setMaxCost(e.target.value)}
                placeholder="e.g. 1.00"
                className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm"
              />
            </div>
          </div>

          <Button icon={loading ? "hourglass_empty" : "calculate"} onClick={handleSimulate} disabled={loading}>
            {loading ? "Simulating..." : "Calculate Costs"}
          </Button>
        </Card>

        {/* Results */}
        {result && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card className="text-center">
                <p className="text-xs text-text-muted mb-1">Cheapest Option</p>
                <p className="text-xl font-bold text-green-500">
                  ${result.breakdown[0]?.monthlyCost?.toFixed(2) ?? "0"}
                </p>
                <p className="text-xs text-text-muted truncate">{result.breakdown[0]?.name?.split("/").pop()}</p>
              </Card>
              <Card className="text-center">
                <p className="text-xs text-text-muted mb-1">vs. Baseline</p>
                <p className="text-xl font-bold">
                  {result.baseline
                    ? `$${result.baseline.monthlyCost.toFixed(2)}`
                    : "N/A"}
                </p>
                <p className="text-xs text-text-muted">unconstrained cheapest</p>
              </Card>
              <Card className="text-center">
                <p className="text-xs text-text-muted mb-1">Free Options</p>
                <p className="text-xl font-bold">
                  {result.breakdown.filter(m => m.isFree).length}
                </p>
                <p className="text-xs text-text-muted">models available</p>
              </Card>
              <Card className="text-center">
                <p className="text-xs text-text-muted mb-1">Monthly Requests</p>
                <p className="text-xl font-bold">{result.monthlyRequests.toLocaleString()}</p>
              </Card>
            </div>

            {/* Warnings */}
            {result.warnings?.length > 0 && (
              <div className="flex flex-col gap-2">
                {result.warnings.map((w, i) => (
                  <div key={i} className="flex gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-300">
                    <span className="material-symbols-outlined text-[18px] shrink-0">warning</span>
                    {w}
                  </div>
                ))}
              </div>
            )}

            {/* Chart */}
            {chartData.length > 0 && (
              <Card>
                <h2 className="text-base font-semibold mb-4">Monthly Cost by Model (USD)</h2>
                <ResponsiveContainer width="100%" height={280} initialDimension={{ width: 600, height: 280 }}>
                  <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                    <Tooltip formatter={v => [`$${Number(v).toFixed(4)}`, "Monthly Cost"]} />
                    <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.isFree ? "#10b981" : COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-text-muted mt-2">
                  <span className="inline-block w-3 h-3 rounded-sm bg-green-500 mr-1" />Free models shown in green
                </p>
              </Card>
            )}

            {/* Table */}
            <Card>
              <h2 className="text-base font-semibold mb-4">Full Breakdown</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-text-muted border-b border-border">
                      <th className="text-left pb-2 pr-4">Model</th>
                      <th className="text-right pb-2 pr-4">Input / 1M</th>
                      <th className="text-right pb-2 pr-4">Output / 1M</th>
                      <th className="text-right pb-2 pr-4">Per Request</th>
                      <th className="text-right pb-2">Monthly</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.breakdown.map((m, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono truncate max-w-[180px]">{m.name.split("/").pop()}</span>
                            {m.isFree && <Badge variant="success" size="sm">Free</Badge>}
                            {m.warnings?.length > 0 && (
                              <span className="material-symbols-outlined text-amber-500 text-[14px]" title={m.warnings.join("; ")}>warning</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-xs">${(m.inputPrice || 0).toFixed(4)}</td>
                        <td className="py-2 pr-4 text-right font-mono text-xs">${(m.outputPrice || 0).toFixed(4)}</td>
                        <td className="py-2 pr-4 text-right font-mono text-xs">${(m.costPerRequest || 0).toFixed(6)}</td>
                        <td className={`py-2 text-right font-mono text-xs font-semibold ${i === 0 ? "text-green-500" : ""}`}>
                          {m.isFree ? "$0.00" : `$${m.monthlyCost.toFixed(2)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Saved scenarios */}
            {savedScenarios.length > 0 && (
              <Card>
                <h2 className="text-base font-semibold mb-3">Saved Scenarios</h2>
                <div className="flex flex-col gap-2">
                  {savedScenarios.map((s, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-border">
                      <div>
                        <p className="font-medium text-sm">{s.name}</p>
                        <p className="text-xs text-text-muted">
                          {s.requestsPerDay}/day · {s.avgInputTokens}+{s.avgOutputTokens} tokens · {s.scenario}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => {
                        setRequestsPerDay(s.requestsPerDay);
                        setAvgInputTokens(s.avgInputTokens);
                        setAvgOutputTokens(s.avgOutputTokens);
                        setActiveScenario(s.scenario);
                        setMaxCost(s.maxCost || "");
                      }}>Load</Button>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </ExpertGate>
  );
}
