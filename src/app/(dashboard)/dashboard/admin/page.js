"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import Input from "@/shared/components/Input";
import Select from "@/shared/components/Select";
import Modal, { ConfirmModal } from "@/shared/components/Modal";
import SegmentedControl from "@/shared/components/SegmentedControl";
import { safeFetchJson, formatRequestError } from "@/shared/utils";

const ROLE_OPTIONS = [
  { value: "superadmin", label: "Superadmin" },
  { value: "admin", label: "Admin" },
  { value: "user", label: "User" },
  { value: "viewer", label: "Viewer" },
];

function roleBadgeVariant(role) {
  switch (role) {
    case "superadmin":
      return "error";
    case "admin":
      return "warning";
    case "user":
      return "info";
    default:
      return "default";
  }
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString();
}

function formatCost(n) {
  return `$${Number(n || 0).toFixed(4)}`;
}

// ── Users section ───────────────────────────────────────────────────────────
function UsersSection() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Create/edit modal state.
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null); // null => create
  const [form, setForm] = useState({ username: "", password: "", role: "viewer", email: "" });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Deactivate confirm state.
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [deactivating, setDeactivating] = useState(false);
  const [rowError, setRowError] = useState({}); // { [id]: message }

  const loadUsers = useCallback(async () => {
    // NB: no synchronous setState here — the first state update happens after the
    // await, so this is safe to call directly from useEffect (react-hooks/set-state-in-effect).
    const res = await safeFetchJson("/api/admin/users", { credentials: "include" });
    if (res.ok) {
      setUsers(Array.isArray(res.data?.users) ? res.data.users : []);
      setLoadError("");
    } else {
      setLoadError(formatRequestError("Failed to load users", res));
    }
    setLoading(false);
  }, []);

  // Initial load: inline async fetch (matches the repo's fetch-on-mount pattern,
  // e.g. usage/page.js) so no memoized setState-callback is invoked in the effect
  // body. loadUsers() above is reused by the mutation handlers for refresh.
  useEffect(() => {
    const run = async () => {
      const res = await safeFetchJson("/api/admin/users", { credentials: "include" });
      if (res.ok) {
        setUsers(Array.isArray(res.data?.users) ? res.data.users : []);
        setLoadError("");
      } else {
        setLoadError(formatRequestError("Failed to load users", res));
      }
      setLoading(false);
    };
    run();
  }, []);

  const openCreate = () => {
    setEditingUser(null);
    setForm({ username: "", password: "", role: "viewer", email: "" });
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (user) => {
    setEditingUser(user);
    setForm({
      username: user.username || "",
      password: "",
      role: user.role || "viewer",
      email: user.email || "",
    });
    setFormError("");
    setModalOpen(true);
  };

  const submitForm = async () => {
    setFormError("");

    if (!editingUser) {
      // Create
      if (!form.username.trim()) {
        setFormError("Username is required");
        return;
      }
      if (!form.password) {
        setFormError("Password is required");
        return;
      }
    }

    setSaving(true);
    let res;
    if (editingUser) {
      // Edit: send role + email (and password only if provided).
      const body = { role: form.role, email: form.email.trim() };
      if (form.password) body.password = form.password;
      res = await safeFetchJson(`/api/admin/users/${editingUser.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      res = await safeFetchJson("/api/admin/users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
          role: form.role,
          email: form.email.trim() || undefined,
        }),
      });
    }
    setSaving(false);

    if (res.ok) {
      setModalOpen(false);
      await loadUsers();
    } else {
      // Surface 400/403/409 messages inline in the modal.
      setFormError(formatRequestError("Save failed", res));
    }
  };

  // Toggle is_active via PATCH (activate/deactivate without removing).
  const toggleActive = async (user) => {
    setRowError((prev) => ({ ...prev, [user.id]: "" }));
    const res = await safeFetchJson(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !user.is_active }),
    });
    if (res.ok) {
      await loadUsers();
    } else {
      setRowError((prev) => ({ ...prev, [user.id]: formatRequestError("Update failed", res) }));
    }
  };

  // Deactivate (DELETE = soft-deactivate).
  const confirmDeactivate = async () => {
    if (!confirmTarget) return;
    setDeactivating(true);
    const res = await safeFetchJson(`/api/admin/users/${confirmTarget.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    setDeactivating(false);
    if (res.ok) {
      setConfirmTarget(null);
      await loadUsers();
    } else {
      setRowError((prev) => ({
        ...prev,
        [confirmTarget.id]: formatRequestError("Deactivate failed", res),
      }));
      setConfirmTarget(null);
    }
  };

  return (
    <Card title="Users" icon="group" subtitle="Manage dashboard accounts and roles"
      action={<Button size="sm" icon="person_add" onClick={openCreate}>New User</Button>}>
      {loadError && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-sm">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-text-muted text-sm">Loading users…</div>
      ) : users.length === 0 ? (
        <div className="py-10 text-center text-text-muted">
          <span className="material-symbols-outlined text-4xl block mb-3 opacity-30">person_off</span>
          <p className="text-sm">No users yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-black/5 dark:border-white/5">
                <th className="py-2 pr-4 font-medium">Username</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-black/[0.03] dark:border-white/[0.03]">
                  <td className="py-2.5 pr-4 font-medium text-text-main align-top">{user.username}</td>
                  <td className="py-2.5 pr-4 align-top">
                    <Badge variant={roleBadgeVariant(user.role)} size="sm">{user.role}</Badge>
                  </td>
                  <td className="py-2.5 pr-4 text-text-muted align-top">{user.email || "—"}</td>
                  <td className="py-2.5 pr-4 align-top">
                    {user.is_active === false ? (
                      <Badge variant="default" size="sm">Inactive</Badge>
                    ) : (
                      <Badge variant="success" size="sm" dot>Active</Badge>
                    )}
                  </td>
                  <td className="py-2.5 pr-0 align-top">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" icon="edit" onClick={() => openEdit(user)}>Edit</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={user.is_active === false ? "toggle_off" : "toggle_on"}
                        onClick={() => toggleActive(user)}
                      >
                        {user.is_active === false ? "Activate" : "Deactivate"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="delete"
                        className="text-red-500"
                        onClick={() => setConfirmTarget(user)}
                      >
                        Remove
                      </Button>
                    </div>
                    {rowError[user.id] && (
                      <p className="text-xs text-red-500 mt-1 text-right">{rowError[user.id]}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingUser ? `Edit ${editingUser.username}` : "Create User"}
      >
        <div className="flex flex-col gap-4">
          {formError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-sm">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <span>{formError}</span>
            </div>
          )}

          {!editingUser && (
            <Input
              label="Username"
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="jane.doe"
            />
          )}

          <Input
            label={editingUser ? "New Password (leave blank to keep)" : "Password"}
            type="password"
            required={!editingUser}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="••••••••"
          />

          <Select
            label="Role"
            options={ROLE_OPTIONS}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          />

          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="jane@example.com"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submitForm} loading={saving}>
              {editingUser ? "Save Changes" : "Create User"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Deactivate confirm */}
      <ConfirmModal
        isOpen={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmDeactivate}
        title="Deactivate User"
        message={confirmTarget ? `Deactivate "${confirmTarget.username}"? They will no longer be able to sign in.` : ""}
        confirmText="Deactivate"
        cancelText="Cancel"
        variant="danger"
        loading={deactivating}
      />
    </Card>
  );
}

// ── Usage section ───────────────────────────────────────────────────────────
function UsageSection() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      const res = await safeFetchJson("/api/admin/usage/summary", { credentials: "include" });
      if (!active) return;
      if (res.ok) {
        setSummary(res.data);
      } else {
        setError(formatRequestError("Failed to load usage summary", res));
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const byUser = summary?.byUser && typeof summary.byUser === "object" ? summary.byUser : {};
  const rows = Object.entries(byUser);
  const totals = summary?.totals || {
    requests: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cost: 0,
  };

  return (
    <Card title="Usage Summary" icon="bar_chart" subtitle="Aggregated request + token usage per user">
      {error && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-sm">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-text-muted text-sm">Loading usage…</div>
      ) : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Card.Section>
              <p className="text-xs text-text-muted">Requests</p>
              <p className="text-lg font-semibold text-text-main">{formatNumber(totals.requests)}</p>
            </Card.Section>
            <Card.Section>
              <p className="text-xs text-text-muted">Prompt Tokens</p>
              <p className="text-lg font-semibold text-text-main">{formatNumber(totals.prompt_tokens)}</p>
            </Card.Section>
            <Card.Section>
              <p className="text-xs text-text-muted">Total Tokens</p>
              <p className="text-lg font-semibold text-text-main">{formatNumber(totals.total_tokens)}</p>
            </Card.Section>
            <Card.Section>
              <p className="text-xs text-text-muted">Cost</p>
              <p className="text-lg font-semibold text-text-main">{formatCost(totals.cost)}</p>
            </Card.Section>
          </div>

          {/* Per-user breakdown */}
          {rows.length === 0 ? (
            <div className="py-6 text-center text-text-muted text-sm">No usage records yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted border-b border-black/5 dark:border-white/5">
                    <th className="py-2 pr-4 font-medium">User</th>
                    <th className="py-2 pr-4 font-medium text-right">Requests</th>
                    <th className="py-2 pr-4 font-medium text-right">Prompt</th>
                    <th className="py-2 pr-4 font-medium text-right">Completion</th>
                    <th className="py-2 pr-4 font-medium text-right">Total Tokens</th>
                    <th className="py-2 pr-0 font-medium text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([userKey, stats]) => (
                    <tr key={userKey} className="border-b border-black/[0.03] dark:border-white/[0.03]">
                      <td className="py-2.5 pr-4 font-medium text-text-main">
                        {userKey === "unattributed" ? <span className="text-text-muted italic">Unattributed</span> : userKey}
                      </td>
                      <td className="py-2.5 pr-4 text-right">{formatNumber(stats.requests)}</td>
                      <td className="py-2.5 pr-4 text-right">{formatNumber(stats.prompt_tokens)}</td>
                      <td className="py-2.5 pr-4 text-right">{formatNumber(stats.completion_tokens)}</td>
                      <td className="py-2.5 pr-4 text-right">{formatNumber(stats.total_tokens)}</td>
                      <td className="py-2.5 pr-0 text-right">{formatCost(stats.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState("users");

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-main">Admin</h1>
          <p className="text-sm text-text-muted mt-1">User management and usage attribution</p>
        </div>
      </div>

      <SegmentedControl
        options={[
          { value: "users", label: "Users" },
          { value: "usage", label: "Usage" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "users" && <UsersSection />}
      {tab === "usage" && <UsageSection />}
    </div>
  );
}
