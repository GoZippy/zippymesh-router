"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input, Modal, Badge, CardSkeleton } from "@/shared/components";
import { safeFetchJson } from "@/shared/utils";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function VirtualKeysPage() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createdKey, setCreatedKey] = useState(null);
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => { fetchKeys(); }, []);

  const fetchKeys = async () => {
    const res = await safeFetchJson("/api/virtual-keys");
    if (res.ok) setKeys(res.data?.keys || []);
    setLoading(false);
  };

  const handleCreate = async (formData) => {
    const res = await safeFetchJson("/api/virtual-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (res.ok) {
      setCreatedKey(res.data);
      fetchKeys();
      setShowCreateModal(false);
    }
  };

  const handleRevoke = async (id) => {
    if (!confirm("Revoke this key? It will stop working immediately.")) return;
    await safeFetchJson(`/api/virtual-keys/${id}`, { method: "DELETE" });
    setKeys(keys.filter(k => k.id !== id));
  };

  if (loading) return <div className="flex flex-col gap-4"><CardSkeleton /><CardSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Virtual API Keys</h1>
          <p className="text-sm text-text-muted mt-1">Per-consumer keys with optional budget and rate limits</p>
        </div>
        <Button icon="add" onClick={() => setShowCreateModal(true)}>Create Key</Button>
      </div>

      {keys.length === 0 ? (
        <Card className="text-center py-12">
          <span className="material-symbols-outlined text-[48px] text-text-muted block mb-3">vpn_key</span>
          <p className="font-medium mb-1">No virtual keys yet</p>
          <p className="text-sm text-text-muted mb-4">Create keys for different tools, teams, or projects with optional budget controls</p>
          <Button icon="add" onClick={() => setShowCreateModal(true)}>Create First Key</Button>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {keys.map(key => (
            <Card key={key.id} className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{key.name}</span>
                  <Badge variant={key.is_active ? "success" : "default"}>{key.is_active ? "Active" : "Revoked"}</Badge>
                  {key.team && <Badge variant="secondary">{key.team}</Badge>}
                </div>
                <div className="flex items-center gap-3 text-xs text-text-muted">
                  <code className="font-mono">{key.key_prefix}...</code>
                  {key.owner && <span>Owner: {key.owner}</span>}
                  {key.monthly_token_budget && (
                    <span>{(key.tokens_used_this_month || 0).toLocaleString()} / {key.monthly_token_budget.toLocaleString()} tokens</span>
                  )}
                  {key.rate_limit_rpm && <span>{key.rate_limit_rpm} req/min</span>}
                  {key.last_used_at && <span>Last used: {new Date(key.last_used_at).toLocaleDateString()}</span>}
                </div>
              </div>
              {key.is_active && (
                <button
                  onClick={() => handleRevoke(key.id)}
                  className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500"
                  title="Revoke key"
                >
                  <span className="material-symbols-outlined text-[18px]">block</span>
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      <CreateKeyModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} onCreate={handleCreate} />

      {createdKey && (
        <Modal isOpen={!!createdKey} title="Key Created — Save It Now!" onClose={() => setCreatedKey(null)} closeOnOverlay={false}>
          <div className="flex flex-col gap-4">
            <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-sm text-yellow-800 dark:text-yellow-200">
              This is the only time you will see this key. Copy it now.
            </div>
            <div className="flex gap-2">
              <code className="flex-1 font-mono text-xs p-3 bg-black/5 dark:bg-white/5 rounded-lg break-all">{createdKey.key}</code>
              <Button variant="secondary" icon={copied === "vkey" ? "check" : "content_copy"} onClick={() => copy(createdKey.key, "vkey")}>
                {copied === "vkey" ? "Copied!" : "Copy"}
              </Button>
            </div>
            <Button onClick={() => setCreatedKey(null)} fullWidth>Done</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CreateKeyModal({ isOpen, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [team, setTeam] = useState("");
  const [monthlyTokenBudget, setMonthlyTokenBudget] = useState("");
  const [rateLimitRpm, setRateLimitRpm] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSubmit = () => {
    onCreate({ name, owner: owner || "default", team: team || null, monthlyTokenBudget: monthlyTokenBudget || null, rateLimitRpm: rateLimitRpm || null });
    setName(""); setOwner(""); setTeam(""); setMonthlyTokenBudget(""); setRateLimitRpm("");
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Virtual Key">
      <div className="flex flex-col gap-4">
        <Input label="Key Name" placeholder="e.g. Production Bot" value={name} onChange={e => setName(e.target.value)} />
        <Input label="Owner (optional)" placeholder="e.g. alice" value={owner} onChange={e => setOwner(e.target.value)} />
        <Input label="Team / Project (optional)" placeholder="e.g. engineering" value={team} onChange={e => setTeam(e.target.value)} />
        <button className="text-xs text-primary text-left" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? "Hide" : "Show"} budget &amp; rate limits
        </button>
        {showAdvanced && (
          <>
            <Input label="Monthly Token Budget (optional)" placeholder="e.g. 1000000" type="number" value={monthlyTokenBudget} onChange={e => setMonthlyTokenBudget(e.target.value)} />
            <Input label="Rate Limit (requests/min, optional)" placeholder="e.g. 60" type="number" value={rateLimitRpm} onChange={e => setRateLimitRpm(e.target.value)} />
          </>
        )}
        <div className="flex gap-2 pt-2">
          <Button onClick={handleSubmit} disabled={!name.trim()} fullWidth>Create Key</Button>
          <Button variant="ghost" onClick={onClose} fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
