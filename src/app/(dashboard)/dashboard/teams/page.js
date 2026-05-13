"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import { safeFetchJson } from "@/shared/utils";

export default function TeamsPage() {
  const [orgs, setOrgs] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [teams, setTeams] = useState([]);
  const [members, setMembers] = useState({});
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamSlug, setNewTeamSlug] = useState('');

  useEffect(() => {
    safeFetchJson('/api/orgs').then(r => { if (r.ok) setOrgs(r.data.organizations || []); });
  }, []);

  const loadTeams = async (orgId) => {
    setSelectedOrg(orgId);
    const r = await safeFetchJson(`/api/orgs/${orgId}/teams`);
    if (r.ok) setTeams(r.data.teams || []);
  };

  const loadMembers = async (teamId) => {
    const r = await safeFetchJson(`/api/orgs/${selectedOrg}/teams/${teamId}/members`);
    if (r.ok) setMembers(prev => ({ ...prev, [teamId]: r.data.members || [] }));
  };

  const createOrg = async () => {
    if (!newOrgName || !newOrgSlug) return;
    const r = await fetch('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newOrgName, slug: newOrgSlug }),
    });
    const data = await r.json();
    if (r.ok) { setOrgs(prev => [...prev, data]); setShowCreateOrg(false); setNewOrgName(''); setNewOrgSlug(''); }
  };

  const createTeam = async () => {
    if (!newTeamName || !newTeamSlug || !selectedOrg) return;
    const r = await fetch(`/api/orgs/${selectedOrg}/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTeamName, slug: newTeamSlug }),
    });
    const data = await r.json();
    if (r.ok) { setTeams(prev => [...prev, data]); setShowCreateTeam(false); setNewTeamName(''); setNewTeamSlug(''); }
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Teams</h1>
          <p className="text-sm text-text-muted mt-1">Manage organizations, teams, and access control</p>
        </div>
        <Button icon="add" onClick={() => setShowCreateOrg(true)}>New Organization</Button>
      </div>

      {orgs.length === 0 ? (
        <Card>
          <div className="text-center py-12 text-text-muted">
            <span className="material-symbols-outlined text-4xl block mb-3 opacity-30">corporate_fare</span>
            <p className="text-sm">No organizations yet. Create one to start managing teams and access.</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Org list */}
          <Card className="md:col-span-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted mb-3">Organizations</h2>
            <div className="flex flex-col gap-1">
              {orgs.map(org => (
                <button key={org.id}
                  onClick={() => loadTeams(org.id)}
                  className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedOrg === org.id ? 'bg-primary/10 text-primary' : 'hover:bg-surface'}`}>
                  <p className="font-medium">{org.name}</p>
                  <p className="text-xs text-text-muted">{org.slug}</p>
                </button>
              ))}
            </div>
          </Card>

          {/* Teams */}
          <Card className="md:col-span-2">
            {!selectedOrg ? (
              <p className="text-sm text-text-muted text-center py-8">Select an organization to view teams</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Teams</h2>
                  <Button size="sm" icon="group_add" onClick={() => setShowCreateTeam(true)}>Add Team</Button>
                </div>
                {teams.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-6">No teams in this organization</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {teams.map(team => (
                      <div key={team.id} className="border border-border rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{team.name}</p>
                            <p className="text-xs text-text-muted font-mono">{team.slug}</p>
                          </div>
                          <Button variant="ghost" size="xs" onClick={() => loadMembers(team.id)}>
                            Members
                          </Button>
                        </div>
                        {members[team.id] && (
                          <div className="mt-2 pt-2 border-t border-border/50">
                            {members[team.id].length === 0 ? (
                              <p className="text-xs text-text-muted">No members</p>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {members[team.id].map(m => (
                                  <div key={m.id} className="flex items-center gap-1">
                                    <span className="text-xs">{m.user_identifier}</span>
                                    <Badge size="xs" variant={m.role === 'admin' ? 'primary' : 'secondary'}>{m.role}</Badge>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {/* Create Org Modal */}
      {showCreateOrg && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-base font-semibold mb-4">Create Organization</h3>
            <div className="flex flex-col gap-3">
              <input value={newOrgName} onChange={e => setNewOrgName(e.target.value)} placeholder="Organization name" className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm" />
              <input value={newOrgSlug} onChange={e => setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="slug (e.g. my-org)" className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm font-mono" />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowCreateOrg(false)}>Cancel</Button>
                <Button size="sm" onClick={createOrg} disabled={!newOrgName || !newOrgSlug}>Create</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Team Modal */}
      {showCreateTeam && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-base font-semibold mb-4">Create Team</h3>
            <div className="flex flex-col gap-3">
              <input value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="Team name" className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm" />
              <input value={newTeamSlug} onChange={e => setNewTeamSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="slug (e.g. engineering)" className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm font-mono" />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowCreateTeam(false)}>Cancel</Button>
                <Button size="sm" onClick={createTeam} disabled={!newTeamName || !newTeamSlug}>Create</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
