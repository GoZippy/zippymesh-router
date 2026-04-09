"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import { Modal, Input } from "@/shared/components";
import ExpertGate from "@/shared/components/ExpertGate";
import { safeFetchJson } from "@/shared/utils";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

function extractVariables(content) {
  const matches = content.match(/\{\{([^}]+)\}\}/g) || [];
  return [...new Set(matches.map(m => m.slice(2, -2).trim()))];
}

function TemplateCard({ template, onUse, onEdit, onDelete, onToggleFavorite }) {
  const vars = extractVariables(template.content);
  const tags = template.tags ? template.tags.split(",").map(t => t.trim()).filter(Boolean) : [];

  return (
    <Card className="flex flex-col gap-3 relative group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm truncate">{template.title}</h3>
            {template.is_favorite ? (
              <span className="material-symbols-outlined text-[14px] text-amber-500 fill-1">star</span>
            ) : null}
          </div>
          {template.description && <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{template.description}</p>}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={() => onToggleFavorite(template)} className="p-1 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded text-amber-500" title="Favorite">
            <span className="material-symbols-outlined text-[16px]">{template.is_favorite ? "star" : "star_border"}</span>
          </button>
          <button onClick={() => onEdit(template)} className="p-1 hover:bg-primary/10 rounded text-primary" title="Edit">
            <span className="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <button onClick={() => onDelete(template.id)} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500" title="Delete">
            <span className="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      </div>

      <pre className="text-xs font-mono text-text-muted bg-black/5 dark:bg-white/5 p-2 rounded-lg overflow-hidden max-h-16 line-clamp-3 whitespace-pre-wrap">
        {template.content.slice(0, 200)}{template.content.length > 200 ? "..." : ""}
      </pre>

      <div className="flex flex-wrap gap-1">
        {vars.map(v => <span key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-mono">{`{{${v}}}`}</span>)}
        {tags.map(t => <Badge key={t} variant="outline" size="sm">{t}</Badge>)}
      </div>

      <div className="flex items-center justify-between mt-auto">
        <span className="text-xs text-text-muted">Used {template.use_count} times</span>
        <Button size="sm" onClick={() => onUse(template)}>Use</Button>
      </div>
    </Card>
  );
}

function EditModal({ isOpen, onClose, onSave, initial }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    setTitle(initial?.title || "");
    setContent(initial?.content || "");
    setDescription(initial?.description || "");
    setTags(initial?.tags || "");
  }, [initial, isOpen]);

  const vars = extractVariables(content);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={initial?.id ? "Edit Template" : "New Prompt Template"} size="xl">
      <div className="flex flex-col gap-4">
        <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Code Review" />
        <div>
          <label className="block text-sm font-medium mb-1">Prompt Content</label>
          <p className="text-xs text-text-muted mb-1">Use <code className="font-mono bg-black/5 dark:bg-white/5 px-1 rounded">{`{{variable_name}}`}</code> for substitution placeholders</p>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={8}
            className="w-full font-mono text-xs p-3 bg-black/5 dark:bg-white/5 border border-border rounded-lg resize-y"
            placeholder="Review this code for {{language}} best practices:&#10;&#10;{{code}}"
          />
          {vars.length > 0 && (
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
              Variables detected: {vars.map(v => <code key={v} className="font-mono bg-blue-50 dark:bg-blue-900/20 px-1 rounded mx-0.5">{v}</code>)}
            </p>
          )}
        </div>
        <Input label="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description" />
        <Input label="Tags (comma-separated)" value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. code, review, python" />
        <div className="flex gap-2 pt-2">
          <Button onClick={() => onSave({ title, content, description, tags })} disabled={!title.trim() || !content.trim()} fullWidth>Save</Button>
          <Button variant="ghost" onClick={onClose} fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

function UseModal({ isOpen, onClose, template }) {
  const vars = template ? extractVariables(template.content) : [];
  const [values, setValues] = useState({});
  const { copy, copied } = useCopyToClipboard();

  useEffect(() => {
    if (template) setValues(Object.fromEntries(vars.map(v => [v, ""])));
  }, [template?.id]);

  const resolved = template?.content.replace(/\{\{([^}]+)\}\}/g, (_, name) => values[name.trim()] || `{{${name.trim()}}}`);

  const handleUse = async () => {
    copy(resolved, "prompt");
    if (template?.id) {
      await safeFetchJson(`/api/prompts/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ increment_use: true }),
      });
    }
  };

  if (!template) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Use: ${template.title}`} size="xl">
      <div className="flex flex-col gap-4">
        {vars.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-3">Fill in variables</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {vars.map(v => (
                <Input key={v} label={v} value={values[v] || ""} onChange={e => setValues(prev => ({ ...prev, [v]: e.target.value }))} placeholder={`Enter ${v}`} />
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="text-xs font-medium text-text-muted mb-1">Preview</p>
          <pre className="text-xs font-mono p-3 bg-black/5 dark:bg-white/5 border border-border rounded-lg overflow-x-auto whitespace-pre-wrap max-h-48">{resolved}</pre>
        </div>
        <div className="flex gap-2">
          <Button icon={copied === "prompt" ? "check" : "content_copy"} onClick={handleUse} fullWidth>
            {copied === "prompt" ? "Copied!" : "Copy to Clipboard"}
          </Button>
          <Button variant="ghost" onClick={onClose} fullWidth>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function PromptsPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [useTarget, setUseTarget] = useState(null);

  const fetchTemplates = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    const res = await safeFetchJson(`/api/prompts?${params}`);
    if (res.ok) setTemplates(res.data?.templates || []);
    setLoading(false);
  }, [search]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const handleSave = async (data) => {
    if (editTarget?.id) {
      await safeFetchJson(`/api/prompts/${editTarget.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    } else {
      await safeFetchJson("/api/prompts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    }
    setShowEdit(false);
    setEditTarget(null);
    fetchTemplates();
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this template?")) return;
    await safeFetchJson(`/api/prompts/${id}`, { method: "DELETE" });
    setTemplates(t => t.filter(x => x.id !== id));
  };

  const handleToggleFavorite = async (template) => {
    await safeFetchJson(`/api/prompts/${template.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_favorite: !template.is_favorite }) });
    fetchTemplates();
  };

  return (
    <ExpertGate featureName="Prompt Library">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Prompt Library</h1>
            <p className="text-sm text-text-muted mt-1">Save, organize, and reuse prompt templates with variable substitution</p>
          </div>
          <Button icon="add" onClick={() => { setEditTarget(null); setShowEdit(true); }}>New Template</Button>
        </div>

        <div className="flex gap-2">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-transparent text-sm"
          />
        </div>

        {loading ? (
          <div className="text-center py-12 text-text-muted animate-pulse">Loading...</div>
        ) : templates.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-[48px] text-text-muted block mb-3">article</span>
            <p className="font-medium mb-1">No templates yet</p>
            <p className="text-sm text-text-muted mb-4">Create reusable prompts with variable placeholders</p>
            <Button icon="add" onClick={() => { setEditTarget(null); setShowEdit(true); }}>Create First Template</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(t => (
              <TemplateCard
                key={t.id}
                template={t}
                onUse={setUseTarget}
                onEdit={(tpl) => { setEditTarget(tpl); setShowEdit(true); }}
                onDelete={handleDelete}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </div>
        )}

        <EditModal isOpen={showEdit} onClose={() => { setShowEdit(false); setEditTarget(null); }} onSave={handleSave} initial={editTarget} />
        <UseModal isOpen={!!useTarget} onClose={() => setUseTarget(null)} template={useTarget} />
      </div>
    </ExpertGate>
  );
}
