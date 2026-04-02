"use client";

import { useEffect, useState, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import Badge from "@/shared/components/Badge";
import Modal from "@/shared/components/Modal";
import { safeFetchJson } from "@/shared/utils";

const CATEGORY_ICONS = {
  "api-key":    "vpn_key",
  "credential": "badge",
  "note":       "sticky_note_2",
  "secret":     "lock",
};

const CATEGORY_LABELS = {
  "api-key":    "API Key",
  "credential": "Credential",
  "note":       "Secure Note",
  "secret":     "Secret",
};

export default function VaultPage() {
  const [status,    setStatus]    = useState(null);   // { unlocked, entryCount }
  const [entries,   setEntries]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");

  // Unlock modal
  const [showUnlock, setShowUnlock] = useState(false);
  const [password,   setPassword]   = useState("");
  const [unlocking,  setUnlocking]  = useState(false);
  const [unlockErr,  setUnlockErr]  = useState("");

  // Add entry modal
  const [showAdd,   setShowAdd]   = useState(false);
  const [addName,   setAddName]   = useState("");
  const [addLabel,  setAddLabel]  = useState("");
  const [addValue,  setAddValue]  = useState("");
  const [addCat,    setAddCat]    = useState("api-key");
  const [addTags,   setAddTags]   = useState("");
  const [adding,    setAdding]    = useState(false);
  const [addErr,    setAddErr]    = useState("");

  // Read entry modal
  const [showRead,  setShowRead]  = useState(false);
  const [readEntry, setReadEntry] = useState(null);
  const [reading,   setReading]   = useState(false);
  const [revealed,  setRevealed]  = useState(false);

  const fetchStatus = useCallback(async () => {
    const r = await safeFetchJson("/api/vault");
    if (r.ok) setStatus(r.data);
  }, []);

  const fetchEntries = useCallback(async () => {
    const r = await safeFetchJson("/api/vault/entries");
    if (r.ok) setEntries(r.data.entries || []);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchStatus(), fetchEntries()]);
      setLoading(false);
    })();
  }, [fetchStatus, fetchEntries]);

  async function handleUnlock(e) {
    e.preventDefault();
    setUnlocking(true);
    setUnlockErr("");
    const r = await safeFetchJson("/api/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unlock", password }),
    });
    setUnlocking(false);
    if (r.ok && r.data.ok) {
      setPassword("");
      setShowUnlock(false);
      await Promise.all([fetchStatus(), fetchEntries()]);
    } else {
      setUnlockErr(r.data?.error || "Unlock failed");
    }
  }

  async function handleLock() {
    await safeFetchJson("/api/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "lock" }),
    });
    await fetchStatus();
    setEntries([]);
  }

  async function handleAdd(e) {
    e.preventDefault();
    setAdding(true);
    setAddErr("");
    const tags = addTags.trim() ? addTags.split(",").map(t => t.trim()).filter(Boolean) : [];
    const r = await safeFetchJson("/api/vault/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: addName.trim(), value: addValue, label: addLabel.trim() || addName.trim(), category: addCat, tags }),
    });
    setAdding(false);
    if (r.ok && r.data.ok) {
      setShowAdd(false);
      setAddName(""); setAddLabel(""); setAddValue(""); setAddCat("api-key"); setAddTags("");
      await fetchEntries();
    } else {
      setAddErr(r.data?.error || "Failed to store entry");
    }
  }

  async function handleReadEntry(entry) {
    setShowRead(true);
    setReading(true);
    setRevealed(false);
    setReadEntry({ ...entry, value: null });
    const r = await safeFetchJson(`/api/vault/entries/${encodeURIComponent(entry.name)}`);
    setReading(false);
    if (r.ok) setReadEntry(r.data);
  }

  async function handleDelete(name) {
    if (!window.confirm(`Delete vault entry "${name}"?`)) return;
    await safeFetchJson(`/api/vault/entries/${encodeURIComponent(name)}`, { method: "DELETE" });
    await fetchEntries();
  }

  if (loading) return <div className="p-8 text-text-muted">Loading ZippyVault…</div>;

  const unlocked = status?.unlocked;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-text-main">
            <span className="material-symbols-outlined text-primary text-2xl">security</span>
            ZippyVault
          </h1>
          <p className="text-sm text-text-muted mt-0.5">
            Local encrypted credential store — AES-256-GCM, PBKDF2 key derivation
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unlocked ? (
            <>
              <Badge variant="success">Unlocked</Badge>
              <Button variant="secondary" size="sm" onClick={handleLock}>Lock</Button>
              <Button size="sm" onClick={() => { setShowAdd(true); setAddErr(""); }}>+ Add Entry</Button>
            </>
          ) : (
            <>
              <Badge variant="warning">Locked</Badge>
              <Button size="sm" onClick={() => { setShowUnlock(true); setUnlockErr(""); }}>Unlock Vault</Button>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Entries list */}
      {entries.length === 0 ? (
        <Card className="p-8 text-center">
          <span className="material-symbols-outlined text-4xl text-text-muted block mb-2">lock</span>
          <p className="text-text-muted text-sm">
            {unlocked ? 'No entries yet. Click "+ Add Entry" to store a credential.' : "Unlock the vault to view stored entries."}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {entries.map(entry => (
            <Card key={entry.name} className="p-4 flex items-center gap-4">
              <span className="material-symbols-outlined text-primary text-xl shrink-0">
                {CATEGORY_ICONS[entry.category] || "key"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-text-main">{entry.label || entry.name}</span>
                  <span className="text-xs text-text-muted font-mono">{entry.name}</span>
                  <Badge variant="secondary" size="sm">{CATEGORY_LABELS[entry.category] || entry.category}</Badge>
                  {(entry.tags || []).map(t => (
                    <Badge key={t} variant="outline" size="sm">{t}</Badge>
                  ))}
                </div>
                <p className="text-xs text-text-muted mt-0.5">Updated {new Date(entry.updated_at).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {unlocked && (
                  <Button variant="ghost" size="sm" onClick={() => handleReadEntry(entry)}>
                    <span className="material-symbols-outlined text-sm">visibility</span>
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => handleDelete(entry.name)}>
                  <span className="material-symbols-outlined text-sm">delete</span>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Security info */}
      <Card className="p-4 border-border/50">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Security</h3>
        <ul className="text-xs text-text-muted space-y-1">
          <li>• AES-256-GCM encryption with per-entry random salt</li>
          <li>• PBKDF2-SHA256 key derivation (210,000 iterations — OWASP recommended)</li>
          <li>• Values stored encrypted in local SQLite only — never transmitted</li>
          <li>• Vault auto-locks on server restart</li>
        </ul>
      </Card>

      {/* Unlock modal */}
      <Modal open={showUnlock} onClose={() => setShowUnlock(false)} title="Unlock ZippyVault">
        <form onSubmit={handleUnlock} className="space-y-4">
          <p className="text-sm text-text-muted">Enter your vault password to decrypt entries.</p>
          <Input
            type="password"
            placeholder="Vault password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
          />
          {unlockErr && <p className="text-sm text-red-400">{unlockErr}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" type="button" onClick={() => setShowUnlock(false)}>Cancel</Button>
            <Button type="submit" loading={unlocking}>Unlock</Button>
          </div>
        </form>
      </Modal>

      {/* Add entry modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Vault Entry">
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-text-muted mb-1 block">Key name <span className="text-red-400">*</span></label>
              <Input placeholder="e.g. OPENAI_API_KEY" value={addName} onChange={e => setAddName(e.target.value)} required />
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">Display label</label>
              <Input placeholder="OpenAI API Key" value={addLabel} onChange={e => setAddLabel(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">Category</label>
              <select
                className="w-full rounded border border-border bg-background text-text-main px-3 py-2 text-sm"
                value={addCat}
                onChange={e => setAddCat(e.target.value)}
              >
                {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-text-muted mb-1 block">Value <span className="text-red-400">*</span></label>
              <Input type="password" placeholder="Secret value" value={addValue} onChange={e => setAddValue(e.target.value)} required />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-text-muted mb-1 block">Tags (comma-separated)</label>
              <Input placeholder="openai, production" value={addTags} onChange={e => setAddTags(e.target.value)} />
            </div>
          </div>
          {addErr && <p className="text-sm text-red-400">{addErr}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button type="submit" loading={adding}>Store Encrypted</Button>
          </div>
        </form>
      </Modal>

      {/* Read entry modal */}
      <Modal open={showRead} onClose={() => { setShowRead(false); setRevealed(false); }} title={`Entry: ${readEntry?.label || readEntry?.name}`}>
        {reading ? (
          <p className="text-sm text-text-muted">Decrypting…</p>
        ) : readEntry ? (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-text-muted mb-1">Key name</p>
              <p className="font-mono text-sm">{readEntry.name}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1">Value</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-surface rounded p-2 text-sm font-mono break-all select-all">
                  {revealed ? readEntry.value : "•".repeat(Math.min((readEntry.value || "").length, 32))}
                </code>
                <Button variant="ghost" size="sm" onClick={() => setRevealed(r => !r)}>
                  <span className="material-symbols-outlined text-sm">{revealed ? "visibility_off" : "visibility"}</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigator.clipboard?.writeText(readEntry.value)}>
                  <span className="material-symbols-outlined text-sm">content_copy</span>
                </Button>
              </div>
            </div>
            <Button variant="secondary" className="w-full" onClick={() => { setShowRead(false); setRevealed(false); }}>Close</Button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
