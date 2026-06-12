"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import { safeFetchJson } from "@/shared/utils";

const UPTIME_COLOR = (pct) => pct >= 99.9 ? 'text-green-500' : pct >= 99.0 ? 'text-yellow-500' : 'text-red-500';
const LATENCY_COLOR = (ms) => ms === null ? 'text-text-muted' : ms < 500 ? 'text-green-500' : ms < 2000 ? 'text-yellow-500' : 'text-red-500';

export default function SlaPage() {
  const [stats, setStats] = useState([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [configModal, setConfigModal] = useState(null);
  const [report, setReport] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await safeFetchJson(`/api/sla?hours=${hours}`);
    if (r.ok) setStats(r.data.stats || []);
    setLoading(false);
  }, [hours]);

  useEffect(() => { load(); }, [load]);

  const handleEnable = async (provider) => {
    await fetch('/api/sla', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, action: 'enable' }) });
    load();
  };

  const handleWeeklyReport = async () => {
    const r = await safeFetchJson('/api/sla?report=weekly');
    if (r.ok) setReport(r.data);
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SLA Monitoring</h1>
          <p className="text-sm text-text-muted mt-1">Per-provider uptime, latency, and SLA thresholds</p>
        </div>
        <div className="flex gap-2">
          <select value={hours} onChange={e => setHours(parseInt(e.target.value))}
            className="px-3 py-2 rounded-lg border border-border bg-bg text-sm">
            {[1,6,24,48,168].map(h => <option key={h} value={h}>{h}h</option>)}
          </select>
          <Button variant="ghost" size="sm" icon="assessment" onClick={handleWeeklyReport}>Weekly Report</Button>
          <Button variant="ghost" size="sm" icon="refresh" onClick={load}>Refresh</Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-muted text-sm">Loading SLA data...</div>
      ) : stats.length === 0 ? (
        <Card>
          <div className="text-center py-12 text-text-muted">
            <span className="material-symbols-outlined text-4xl block mb-3 opacity-30">speed</span>
            <p className="text-sm">No SLA data yet. Provider data will appear here after requests are processed.</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {stats.map(s => (
            <Card key={s.provider}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${s.isDisabled ? 'bg-red-500' : s.uptime_pct >= 99 ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">{s.provider}</p>
                      {s.isDisabled && <Badge size="xs" variant="destructive">Disabled (SLA breach)</Badge>}
                    </div>
                    <p className="text-xs text-text-muted">{s.total_requests} requests in {hours}h window</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-xs text-text-muted">Uptime</p>
                    <p className={`text-lg font-bold ${UPTIME_COLOR(s.uptime_pct)}`}>{s.uptime_pct?.toFixed(1)}%</p>
                    {s.config && <p className="text-xs text-text-muted">target {s.config.target_uptime_pct}%</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-text-muted">Avg latency</p>
                    <p className={`text-lg font-bold ${LATENCY_COLOR(s.avg_latency_ms)}`}>{s.avg_latency_ms ?? '—'}ms</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-text-muted">P95 latency</p>
                    <p className={`text-lg font-bold ${LATENCY_COLOR(s.p95LatencyMs)}`}>{s.p95LatencyMs ?? '—'}ms</p>
                    {s.config && <p className="text-xs text-text-muted">target &lt;{s.config.target_p95_latency_ms}ms</p>}
                  </div>
                  <div className="flex gap-2">
                    {s.isDisabled && (
                      <Button size="sm" variant="secondary" onClick={() => handleEnable(s.provider)}>Re-enable</Button>
                    )}
                    <Button size="sm" variant="ghost" icon="settings" onClick={() => setConfigModal(s.provider)}>Configure</Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {report && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Weekly SLA Report</h2>
            <button onClick={() => setReport(null)} className="text-text-muted hover:text-text-main">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
          <p className="text-xs text-text-muted mb-3">Generated: {new Date(report.generatedAt).toLocaleString()} · Period: {report.periodDays} days</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-text-muted border-b border-border text-xs">
                <th className="text-left py-2 pr-4">Provider</th>
                <th className="text-right py-2 pr-4">Uptime</th>
                <th className="text-right py-2 pr-4">Requests</th>
                <th className="text-right py-2 pr-4">Avg Latency</th>
                <th className="text-right py-2">P95 Latency</th>
              </tr></thead>
              <tbody>
                {(report.providers || []).map(p => (
                  <tr key={p.provider} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-medium">{p.provider}</td>
                    <td className={`py-2 pr-4 text-right font-mono ${UPTIME_COLOR(p.uptimePct)}`}>{p.uptimePct?.toFixed(2)}%</td>
                    <td className="py-2 pr-4 text-right">{p.totalRequests}</td>
                    <td className="py-2 pr-4 text-right font-mono">{p.avgLatencyMs ?? '—'}ms</td>
                    <td className="py-2 text-right font-mono">{p.p95LatencyMs ?? '—'}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {configModal && (
        <SlaConfigModal provider={configModal} onClose={() => { setConfigModal(null); load(); }} />
      )}
    </div>
  );
}

function SlaConfigModal({ provider, onClose }) {
  const [form, setForm] = useState({ targetUptimePct: 99.5, targetP95LatencyMs: 2000, autoDisable: false, breachWindowMinutes: 60 });

  useEffect(() => {
    safeFetchJson(`/api/sla?provider=${encodeURIComponent(provider)}&hours=24`).then(r => {
      const config = r.data?.stats?.[0]?.config;
      if (config) setForm({
        targetUptimePct: config.target_uptime_pct,
        targetP95LatencyMs: config.target_p95_latency_ms,
        autoDisable: config.auto_disable_on_breach === 1,
        breachWindowMinutes: config.breach_window_minutes,
      });
    });
  }, [provider]);

  const handleSave = async () => {
    await fetch('/api/sla', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, ...form }) });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-sm shadow-xl">
        <h3 className="text-base font-semibold mb-4">SLA Config: {provider}</h3>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-text-muted mb-1 block">Target Uptime (%)</label>
            <input type="number" value={form.targetUptimePct} min="0" max="100" step="0.1"
              onChange={e => setForm(p => ({ ...p, targetUptimePct: parseFloat(e.target.value) }))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm" />
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Target P95 Latency (ms)</label>
            <input type="number" value={form.targetP95LatencyMs} min="100" step="100"
              onChange={e => setForm(p => ({ ...p, targetP95LatencyMs: parseInt(e.target.value) }))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="autoDisable" checked={form.autoDisable}
              onChange={e => setForm(p => ({ ...p, autoDisable: e.target.checked }))}
              className="rounded" />
            <label htmlFor="autoDisable" className="text-sm">Auto-disable on breach</label>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
