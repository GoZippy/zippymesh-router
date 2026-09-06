"use client";

/**
 * ZippyVault — Agent Tokens panel.
 *
 * Issue / list / revoke the scoped bearer tokens that let an outside agent
 * (the Kiro Crew ZippyVault Bridge, `zvault run`, an MCP stdio client) read
 * the vault entries you scope it to, without ever seeing the master password.
 *
 * Lock state: issuing, listing and revoking tokens do NOT require an unlocked
 * vault — POST /api/vault/tokens only writes a hash row (src/lib/vaultTokens.js
 * issueAgentToken) and never touches the master key. Only *using* a token to
 * read a secret value needs the vault unlocked. The panel says so in-line.
 *
 * The raw token is displayed exactly once, lives only in the reveal reducer's
 * state, and is dropped on Done / close. It is never logged, stored, or put in
 * a URL.
 */

import { useCallback, useEffect, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import Badge from "@/shared/components/Badge";
import Modal, { ConfirmModal } from "@/shared/components/Modal";
import {
  ALL_ENTRIES_SCOPE,
  DEFAULT_EXPIRY,
  EXPIRY_OPTIONS,
  REVEAL_INITIAL,
  SCOPE_WRITE_NOTE,
  buildIssuePayload,
  formatExpiry,
  formatLastUsed,
  formatScopeLabel,
  formatTimestamp,
  isExpired,
  revealReducer,
  revealedToken,
} from "./agentTokenLogic.js";
import { issueToken, listEntryNames, listTokens, revokeToken } from "./agentTokensApi.js";

const SELECT_CLASS =
  "w-full rounded border border-border bg-background text-text-main px-3 py-2 text-sm";

export default function AgentTokensPanel() {
  const router = useRouter();

  const [tokens,  setTokens]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  // "now" is state, not a Date.now() call during render: reading the clock while
  // rendering is impure (react-hooks/purity) and would also desync SSR markup
  // from the first client paint. Ticks once a minute so relative times age.
  const [now, setNow] = useState(0);

  // Issue modal
  const [showIssue,     setShowIssue]     = useState(false);
  const [name,          setName]          = useState("");
  const [allEntries,    setAllEntries]    = useState(false);
  const [selectedNames, setSelectedNames] = useState([]);
  const [expiry,        setExpiry]        = useState(DEFAULT_EXPIRY);
  const [issuing,       setIssuing]       = useState(false);
  const [formErr,       setFormErr]       = useState("");
  const [pickerEntries, setPickerEntries] = useState([]);
  const [pickerErr,     setPickerErr]     = useState("");

  // One-time reveal
  const [reveal, dispatchReveal] = useReducer(revealReducer, REVEAL_INITIAL);
  const [copied, setCopied]      = useState(false);

  // Revoke confirm
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking,     setRevoking]     = useState(false);

  const handleUnauthorized = useCallback(() => {
    router.push("/login");
  }, [router]);

  // Only subscribes to the clock; the initial value comes from refresh() below,
  // so nothing sets state synchronously in an effect body.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    setNow(Date.now());
    const r = await listTokens();
    if (r.ok) {
      setTokens(r.tokens);
      setError("");
      return;
    }
    if (r.unauthorized) {
      handleUnauthorized();
      return;
    }
    setError(r.error);
  }, [handleUnauthorized]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  async function openIssue() {
    setName("");
    setAllEntries(false);
    setSelectedNames([]);
    setExpiry(DEFAULT_EXPIRY);
    setFormErr("");
    setPickerErr("");
    dispatchReveal({ type: "reset" });
    setShowIssue(true);

    const r = await listEntryNames();
    if (r.ok) {
      setPickerEntries(r.entries);
    } else if (r.unauthorized) {
      handleUnauthorized();
    } else {
      setPickerEntries([]);
      setPickerErr(r.error);
    }
  }

  function toggleEntry(entryName) {
    setSelectedNames(prev =>
      prev.includes(entryName) ? prev.filter(n => n !== entryName) : [...prev, entryName]
    );
  }

  async function handleIssue(e) {
    e.preventDefault();
    const built = buildIssuePayload({ name, allEntries, selectedNames, expiry });
    if (!built.ok) {
      setFormErr(built.error);
      return;
    }
    setFormErr("");
    setIssuing(true);
    dispatchReveal({ type: "issue_start" });
    const r = await issueToken(built.payload);
    setIssuing(false);

    if (r.ok) {
      setCopied(false);
      dispatchReveal({ type: "issue_success", token: r.token });
      await refresh();
      return;
    }
    dispatchReveal({ type: "issue_error", error: r.error });
    if (r.unauthorized) {
      handleUnauthorized();
      return;
    }
    setFormErr(r.error);
  }

  /** Drops the raw token from state and closes the modal. */
  function finishReveal() {
    dispatchReveal({ type: "done" });
    setCopied(false);
    setShowIssue(false);
  }

  async function handleCopy() {
    const raw = revealedToken(reveal);
    if (!raw) return;
    try {
      await navigator.clipboard?.writeText(raw);
      setCopied(true);
    } catch {
      // Clipboard is unavailable (insecure context / denied). The field is
      // selectable, so the user can still copy by hand.
      setCopied(false);
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    const r = await revokeToken(revokeTarget.id);
    setRevoking(false);
    setRevokeTarget(null);
    if (!r.ok) {
      if (r.unauthorized) {
        handleUnauthorized();
        return;
      }
      setError(r.error);
      return;
    }
    await refresh();
  }

  const raw       = revealedToken(reveal);
  const revealing = reveal.status === "revealed";

  return (
    <Card className="p-4 border-border/50">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1 flex items-center gap-2">
            Agent Tokens
            <Badge variant={tokens.length ? "primary" : "secondary"} size="sm">
              {tokens.length} active
            </Badge>
          </h3>
          <p className="text-xs text-text-muted">
            Scoped, revocable bearer tokens for agents that need vault entries — no master password.
          </p>
        </div>
        <Button size="sm" onClick={openIssue}>+ Issue Token</Button>
      </div>

      <p className="text-[11px] text-text-muted mb-3">
        Issuing, listing and revoking work whether the vault is locked or unlocked. A token can
        only read a secret <em>value</em> while the vault is unlocked.
      </p>

      {error && <p className="text-sm text-red-400 mb-2">{error}</p>}

      {/* Body */}
      {loading || !now ? (
        <p className="text-sm text-text-muted">Loading agent tokens…</p>
      ) : tokens.length === 0 ? (
        <div className="rounded border border-dashed border-black/10 dark:border-white/10 p-4 text-center">
          <span className="material-symbols-outlined text-3xl text-text-muted block mb-1">key</span>
          <p className="text-xs text-text-muted">
            No agent tokens yet. Agent tokens let an outside agent — the Kiro Crew ZippyVault
            Bridge, <code className="font-mono">zvault run</code>, or an MCP stdio client — read
            only the entries you scope it to.
          </p>
          <p className="text-xs text-text-muted mt-1">
            Issue one per agent, keep the scope as narrow as the job needs, and revoke it here the
            moment that agent is done.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-text-muted">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Scopes</th>
                <th className="py-2 pr-3 font-medium">Created</th>
                <th className="py-2 pr-3 font-medium">Expires</th>
                <th className="py-2 pr-3 font-medium">Last used</th>
                <th className="py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id} className="border-t border-black/5 dark:border-white/5 align-top">
                  <td className="py-2 pr-3">
                    <span className="font-medium text-text-main">{t.name}</span>
                    <span className="block font-mono text-[10px] text-text-muted">{t.id}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex flex-wrap gap-1">
                      {(t.scopes || []).map(s => (
                        <Badge
                          key={s}
                          size="sm"
                          variant={s === ALL_ENTRIES_SCOPE ? "warning" : "secondary"}
                        >
                          {formatScopeLabel(s)}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-text-muted">{formatTimestamp(t.created_at)}</td>
                  <td className="py-2 pr-3">
                    {isExpired(t, now) ? (
                      <Badge variant="error" size="sm">Expired</Badge>
                    ) : (
                      <span className="text-text-muted">{formatExpiry(t.expires_at, now)}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-text-muted">{formatLastUsed(t.last_used_at, now)}</td>
                  <td className="py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-400 hover:text-red-300"
                      onClick={() => setRevokeTarget(t)}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Issue + one-time reveal modal */}
      <Modal
        isOpen={showIssue}
        onClose={revealing ? finishReveal : () => setShowIssue(false)}
        title={revealing ? "Copy your token now" : "Issue Agent Token"}
        closeOnOverlay={!revealing}
      >
        {revealing ? (
          <div className="space-y-4">
            <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-3">
              <p className="text-sm font-semibold text-yellow-600 dark:text-yellow-400">
                Shown once — store it now.
              </p>
              <p className="text-xs text-text-muted mt-1">
                ZippyVault keeps only a SHA-256 hash of this token. Once you close this dialog it
                cannot be shown again; you would have to revoke it and issue a new one.
              </p>
            </div>

            <div>
              <label className="text-xs text-text-muted mb-1 block" htmlFor="agent-token-value">
                Token for <span className="font-medium text-text-main">{reveal.token?.name}</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="agent-token-value"
                  readOnly
                  value={raw || ""}
                  onFocus={e => e.target.select()}
                  className="flex-1 min-w-0 bg-surface border border-black/10 dark:border-white/10 rounded p-2 text-xs font-mono select-all"
                />
                <Button variant="secondary" size="sm" onClick={handleCopy}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            <div className="text-xs text-text-muted space-y-1">
              <p>
                Scopes:{" "}
                {(reveal.token?.scopes || []).map(formatScopeLabel).join(", ") || "—"}
              </p>
              <p>Expires: {formatExpiry(reveal.token?.expiresAt, now)}</p>
            </div>

            <div className="flex justify-end">
              <Button onClick={finishReveal}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleIssue} className="space-y-4">
            <div>
              <label className="text-xs text-text-muted mb-1 block">
                Token name <span className="text-red-400">*</span>
              </label>
              <Input
                placeholder="e.g. kirocrew-bridge"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="text-xs text-text-muted mb-1 block">Scope</label>
              <label className="flex items-center gap-2 text-sm text-text-main mb-2">
                <input
                  type="checkbox"
                  checked={allEntries}
                  onChange={e => setAllEntries(e.target.checked)}
                />
                All entries (<span className="font-mono">*</span>)
              </label>
              <p className="text-[11px] text-text-muted mb-2">{SCOPE_WRITE_NOTE}</p>

              <div
                className={`max-h-40 overflow-y-auto rounded border border-black/10 dark:border-white/10 p-2 space-y-1 ${
                  allEntries ? "opacity-50" : ""
                }`}
              >
                {pickerEntries.length === 0 ? (
                  <p className="text-xs text-text-muted">
                    {pickerErr || "No vault entries yet — add an entry, or scope this token to all entries."}
                  </p>
                ) : (
                  pickerEntries.map(entry => (
                    <label
                      key={entry.name}
                      className="flex items-center gap-2 text-xs text-text-main"
                    >
                      <input
                        type="checkbox"
                        disabled={allEntries}
                        checked={selectedNames.includes(entry.name)}
                        onChange={() => toggleEntry(entry.name)}
                      />
                      <span className="font-mono">{entry.name}</span>
                      {entry.label !== entry.name && (
                        <span className="text-text-muted">{entry.label}</span>
                      )}
                    </label>
                  ))
                )}
              </div>
            </div>

            <div>
              <label className="text-xs text-text-muted mb-1 block" htmlFor="agent-token-expiry">
                Expires
              </label>
              <select
                id="agent-token-expiry"
                className={SELECT_CLASS}
                value={expiry}
                onChange={e => setExpiry(e.target.value)}
              >
                {EXPIRY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {formErr && <p className="text-sm text-red-400">{formErr}</p>}

            <div className="flex gap-2 justify-end">
              <Button variant="secondary" type="button" onClick={() => setShowIssue(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={issuing}>Issue</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Revoke confirmation */}
      <ConfirmModal
        isOpen={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleConfirmRevoke}
        title="Revoke agent token"
        message={
          revokeTarget
            ? `Revoke "${revokeTarget.name}"? Any agent still using it stops working immediately. This cannot be undone.`
            : ""
        }
        confirmText="Revoke"
        loading={revoking}
      />
    </Card>
  );
}
