"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import { safeFetchJson } from "@/shared/utils";

const ACTION_COLORS = {
  gdpr_deletion: 'destructive',
  gdpr_deletion_requested: 'destructive',
  settings_change: 'secondary',
  key_created: 'primary',
  key_revoked: 'secondary',
};

export default function CompliancePage() {
  const [auditLog, setAuditLog] = useState([]);
  const [retention, setRetention] = useState({ retentionDays: 30 });
  const [activeTab, setActiveTab] = useState("audit");
  const [purging, setPurging] = useState(false);
  const [gdprKeyId, setGdprKeyId] = useState('');
  const [gdprResult, setGdprResult] = useState(null);

  const loadAuditLog = useCallback(async () => {
    const r = await safeFetchJson('/api/compliance/audit-log?hours=168&limit=100');
    if (r.ok) setAuditLog(r.data.entries || []);
  }, []);

  const loadRetention = useCallback(async () => {
    const r = await safeFetchJson('/api/compliance/retention');
    if (r.ok) setRetention(r.data);
  }, []);

  useEffect(() => { loadAuditLog(); loadRetention(); }, [loadAuditLog, loadRetention]);

  const handlePurge = async () => {
    if (!confirm(`Purge all traces older than ${retention.retentionDays} days?`)) return;
    setPurging(true);
    const r = await fetch('/api/compliance/retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'purge', retentionDays: retention.retentionDays }),
    });
    const data = await r.json();
    setPurging(false);
    alert(`Purged ${data.deleted ?? 0} trace(s).`);
  };

  const handleGdprDelete = async () => {
    if (!gdprKeyId.trim()) return;
    if (!confirm(`Permanently delete all data for key ${gdprKeyId}? This cannot be undone.`)) return;
    const r = await fetch('/api/compliance/gdpr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyId: gdprKeyId, confirm: true }),
    });
    const data = await r.json();
    setGdprResult(data);
    if (r.ok) { setGdprKeyId(''); loadAuditLog(); }
  };

  const handleRetentionChange = async (days) => {
    setRetention(prev => ({ ...prev, retentionDays: days }));
    await fetch('/api/compliance/retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionDays: days }),
    });
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Compliance</h1>
        <p className="text-sm text-text-muted mt-1">Audit logs, data retention, and GDPR controls</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
        {[{id:'audit', label:'Audit Log'},{id:'retention', label:'Data Retention'},{id:'gdpr', label:'GDPR'}].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab===t.id ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'audit' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Audit Log (last 7 days)</h2>
            <Button variant="ghost" size="sm" icon="refresh" onClick={loadAuditLog}>Refresh</Button>
          </div>
          {auditLog.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">No audit events in the last 7 days</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-text-muted border-b border-border">
                  <th className="text-left py-2 pr-4">Time</th>
                  <th className="text-left py-2 pr-4">Actor</th>
                  <th className="text-left py-2 pr-4">Action</th>
                  <th className="text-left py-2 pr-4">Resource</th>
                </tr></thead>
                <tbody>
                  {auditLog.map(e => (
                    <tr key={e.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-4 font-mono">{new Date(e.timestamp).toLocaleString()}</td>
                      <td className="py-1.5 pr-4">{e.actor || '—'}</td>
                      <td className="py-1.5 pr-4">
                        <Badge size="xs" variant={ACTION_COLORS[e.action] || 'secondary'}>{e.action}</Badge>
                      </td>
                      <td className="py-1.5 pr-4 text-text-muted">{e.resource_type ? `${e.resource_type}:${e.resource_id}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {activeTab === 'retention' && (
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="text-base font-semibold mb-4">Trace Retention</h2>
            <div className="flex items-center gap-4 mb-4">
              <label className="text-sm text-text-muted">Keep traces for</label>
              <select value={retention.retentionDays} onChange={e => handleRetentionChange(parseInt(e.target.value))}
                className="px-3 py-1.5 rounded-lg border border-border bg-bg text-sm">
                {[7,14,30,60,90,180,365].map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
            </div>
            <Button variant="secondary" size="sm" icon="delete_sweep" onClick={handlePurge} disabled={purging}>
              {purging ? 'Purging...' : `Purge traces older than ${retention.retentionDays} days`}
            </Button>
          </Card>
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-4 text-sm">
            <p className="font-semibold text-amber-700 dark:text-amber-300 mb-1">Data Residency</p>
            <p className="text-text-muted">All ZippyMesh data (traces, cached prompts, routing decisions) is stored locally in SQLite. No data is sent to external servers unless you explicitly configure a cloud provider.</p>
          </div>
        </div>
      )}

      {activeTab === 'gdpr' && (
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="text-base font-semibold mb-2">GDPR: Delete User Data</h2>
            <p className="text-sm text-text-muted mb-4">Purge all request traces, cached prompts, and routing memory associated with a virtual key. The key will be revoked. This action is irreversible.</p>
            <div className="flex gap-2">
              <input value={gdprKeyId} onChange={e => setGdprKeyId(e.target.value)} placeholder="Virtual key ID"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-bg text-sm font-mono" />
              <Button variant="destructive" size="sm" onClick={handleGdprDelete} disabled={!gdprKeyId.trim()}>
                Delete Data
              </Button>
            </div>
            {gdprResult && (
              <p className={`mt-2 text-xs ${gdprResult.ok ? 'text-green-500' : 'text-red-500'}`}>
                {gdprResult.ok ? gdprResult.message : gdprResult.error}
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
