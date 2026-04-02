"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import ExpertGate from "@/shared/components/ExpertGate";
import { safeFetchJson } from "@/shared/utils";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

function formatTimestamp(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function StatusBadge({ success, cacheHit }) {
  if (cacheHit) return <Badge variant="info" size="sm">CACHED</Badge>;
  if (success) return <Badge variant="success" size="sm">OK</Badge>;
  return <Badge variant="error" size="sm">FAIL</Badge>;
}

function ParallelSessionsPanel() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchSessions() {
      setLoading(true);
      const res = await safeFetchJson("/api/parallel-sessions");
      if (!cancelled && res.ok) {
        setSessions(res.data?.sessions || []);
      }
      if (!cancelled) {
        setLoading(false);
      }
    }

    fetchSessions();

    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="text-center py-4 text-text-muted text-sm animate-pulse">Loading parallel sessions...</div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="text-center py-4 text-text-muted text-sm">No active parallel sessions. Use X-Session-Parallel: true header to start burst routing.</div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sessions.map(s => (
        <div key={s.id} className="p-3 rounded-lg bg-surface/50 border border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono truncate flex-1" title={s.id}>{s.id}</span>
            <Badge variant="info" size="sm">{s.callCount} calls</Badge>
          </div>
          <p className="text-[10px] text-text-muted mt-1">Last active: {new Date(s.lastUsed).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

function TraceListRow({ trace, selected, onClick }) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${selected ? "bg-primary/10 border border-primary/30" : "hover:bg-surface/50 border border-transparent"}`}
      onClick={onClick}
    >
      <StatusBadge success={!!trace.success} cacheHit={!!trace.cache_hit} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono truncate text-text-muted">{trace.used_model?.split("/").pop() || "unknown"}</span>
          {trace.flagged ? <span className="material-symbols-outlined text-[14px] text-amber-500">flag</span> : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span>{trace.intent || "default"}</span>
          <span>·</span>
          <span>{trace.latency_ms}ms</span>
        </div>
      </div>
      <span className="text-[10px] text-text-muted/60 shrink-0">
        {new Date(trace.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}

function StepsTimeline({ stepsJson }) {
  let steps = [];
  try { steps = JSON.parse(stepsJson || "[]"); } catch { return null; }
  if (!steps.length) return (
    <p className="text-xs text-text-muted italic py-2">No step data captured. Set ZMLR_TRACE_STEPS=true to enable detailed tracing.</p>
  );
  return (
    <div className="flex flex-col gap-2">
      {steps.map((step, i) => (
        <div key={i} className="flex items-start gap-3 text-sm">
          <div className="flex flex-col items-center mt-1">
            <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
            {i < steps.length - 1 && <div className="w-px h-full bg-border mt-1" style={{ minHeight: 16 }} />}
          </div>
          <div className="flex-1 pb-2">
            <div className="flex items-center gap-2">
              <span className="font-medium text-xs">{step.step?.replace(/_/g, " ")}</span>
              {step.durationMs != null && <span className="text-xs text-text-muted">{step.durationMs}ms</span>}
            </div>
            {step.decision && <p className="text-xs text-text-muted mt-0.5">{step.decision}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function TraceDetail({ trace, onFlag }) {
  const { copied, copy } = useCopyToClipboard();

  const handleRepeat = async () => {
    if (!trace.prompt_hash) { alert("No prompt hash recorded for this trace."); return; }
    alert("Repeat request feature requires the original prompt content. Enable ZMLR_TRACE_STEPS=true to capture full request data.");
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge success={!!trace.success} cacheHit={!!trace.cache_hit} />
            <span className="font-medium text-sm">{trace.used_model || trace.selected_model || "unknown"}</span>
          </div>
          <p className="text-xs text-text-muted mt-1">{formatTimestamp(trace.timestamp)}</p>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" icon={trace.flagged ? "flag" : "outlined_flag"} onClick={() => onFlag(trace.id, !trace.flagged)}>
            {trace.flagged ? "Unflag" : "Flag"}
          </Button>
          <Button size="sm" variant="ghost" icon={copied === "trace-id" ? "check" : "content_copy"} onClick={() => copy(String(trace.id), "trace-id")}>
            ID
          </Button>
        </div>
      </div>

      {/* Fields */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Intent", value: trace.intent || "default" },
          { label: "Selected Model", value: trace.selected_model || "—" },
          { label: "Used Model", value: trace.used_model || "—" },
          { label: "Latency", value: `${trace.latency_ms || 0}ms` },
          { label: "Fallback Depth", value: trace.fallback_depth ?? 0 },
          { label: "Cache Hit", value: trace.cache_hit ? "Yes" : "No" },
          { label: "Input Tokens", value: (trace.input_tokens || 0).toLocaleString() },
          { label: "Output Tokens", value: (trace.output_tokens || 0).toLocaleString() },
          { label: "Request ID", value: trace.request_id || "—" },
        ].map(({ label, value }) => (
          <div key={label} className="p-2 rounded-lg bg-surface/50 border border-border">
            <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
            <p className="text-xs font-medium mt-0.5 truncate" title={String(value)}>{String(value)}</p>
          </div>
        ))}
      </div>

      {trace.error_message && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1">Error</p>
          <p className="text-xs text-red-600 dark:text-red-400 font-mono">{trace.error_message}</p>
        </div>
      )}

      {/* Pipeline steps */}
      <div>
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Pipeline Steps</p>
        <StepsTimeline stepsJson={trace.steps_json} />
      </div>

      {trace.constraints_json && (
        <div>
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Constraints</p>
          <pre className="text-xs font-mono p-3 bg-black/5 dark:bg-white/5 rounded-lg overflow-x-auto">
            {JSON.stringify(JSON.parse(trace.constraints_json), null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function TracerPage() {
  const [traces, setTraces] = useState([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedTrace, setSelectedTrace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ intent: "", success: "", flagged: false });
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchTraces() {
      setLoading(true);
      const params = new URLSearchParams({ hours: "72", limit: "50", offset: String(offset) });
      if (filter.intent) params.set("intent", filter.intent);
      const res = await safeFetchJson(`/api/routing/traces?${params}`);
      if (!cancelled && res.ok) {
        let list = res.data?.traces || [];
        if (filter.success === "ok") list = list.filter(t => t.success);
        if (filter.success === "fail") list = list.filter(t => !t.success);
        if (filter.flagged) list = list.filter(t => t.flagged);
        setTraces(list);
        setTotal(res.data?.total || 0);
      }
      if (!cancelled) {
        setLoading(false);
      }
    }

    fetchTraces();

    return () => { cancelled = true; };
  }, [filter, offset]);

  const handleSelect = async (id) => {
    setSelectedId(id);
    const res = await safeFetchJson(`/api/routing/traces/${id}`);
    if (res.ok) setSelectedTrace(res.data);
  };

  const handleFlag = async (id, flagged) => {
    await safeFetchJson(`/api/routing/traces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flagged }),
    });
    setSelectedTrace(t => t ? { ...t, flagged } : t);
    setTraces(list => list.map(t => t.id === id ? { ...t, flagged } : t));
  };

  return (
    <ExpertGate featureName="Request Tracer">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">Request Tracer</h1>
          <p className="text-sm text-text-muted mt-1">Step-by-step routing pipeline visualization for the last 72 hours</p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <select value={filter.intent} onChange={e => setFilter(f => ({ ...f, intent: e.target.value }))}
            className="px-3 py-1.5 rounded-lg border border-border bg-transparent text-sm">
            <option value="">All Intents</option>
            {["code","reasoning","vision","embedding","fast","default"].map(i => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
          <select value={filter.success} onChange={e => setFilter(f => ({ ...f, success: e.target.value }))}
            className="px-3 py-1.5 rounded-lg border border-border bg-transparent text-sm">
            <option value="">All Status</option>
            <option value="ok">Success</option>
            <option value="fail">Failed</option>
          </select>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={filter.flagged} onChange={e => setFilter(f => ({ ...f, flagged: e.target.checked }))} />
            Flagged only
          </label>
          <Button size="sm" variant="ghost" icon="refresh" onClick={fetchTraces}>Refresh</Button>
          <span className="text-xs text-text-muted ml-auto">{total.toLocaleString()} total traces</span>
        </div>

        {/* Parallel Sessions Section */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Parallel Sessions</h2>
          </div>
          <ParallelSessionsPanel />
        </Card>

        <div className="flex gap-4 min-h-[500px]">
          {/* Left: trace list */}
          <div className="w-72 shrink-0 flex flex-col gap-1 overflow-y-auto">
            {loading ? (
              <div className="text-center py-8 text-text-muted text-sm animate-pulse">Loading traces...</div>
            ) : traces.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm">No traces yet. Make requests to see them here.</div>
            ) : (
              traces.map(t => (
                <TraceListRow key={t.id} trace={t} selected={selectedId === t.id} onClick={() => handleSelect(t.id)} />
              ))
            )}
          </div>

          {/* Right: detail */}
          <div className="flex-1 min-w-0">
            {selectedTrace ? (
              <Card>
                <TraceDetail trace={selectedTrace} onFlag={handleFlag} />
              </Card>
            ) : (
              <Card className="flex items-center justify-center h-full min-h-[400px]">
                <div className="text-center">
                  <span className="material-symbols-outlined text-[48px] text-text-muted block mb-3">timeline</span>
                  <p className="text-text-muted text-sm">Select a trace to view details</p>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </ExpertGate>
  );
}
