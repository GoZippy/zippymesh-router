"use client";

import { useState, useEffect } from "react";
import { Card, Badge, Button } from "@/shared/components";
import { safeFetchJson } from "@/shared/utils";

const CATEGORY_FILTERS = [
  { id: "all", label: "All" },
  { id: "code", label: "Code" },
  { id: "cost", label: "Cost" },
  { id: "speed", label: "Speed" },
  { id: "privacy", label: "Privacy" },
  { id: "local", label: "Local" },
];

// Infer category from template name/description/trigger
function getTemplateCategory(template) {
  const text = `${template.name} ${template.description} ${template.trigger?.value || ""}`.toLowerCase();
  if (text.includes("local") || text.includes("ollama") || text.includes("lmstudio")) return "local";
  if (text.includes("privacy") || text.includes("pii") || text.includes("private")) return "privacy";
  if (text.includes("fast") || text.includes("speed") || text.includes("latency") || text.includes("cerebras") || text.includes("groq")) return "speed";
  if (text.includes("cheap") || text.includes("cost") || text.includes("free") || text.includes("budget")) return "cost";
  if (text.includes("code") || text.includes("debug") || text.includes("architect") || text.includes("coder")) return "code";
  return "all";
}

export default function TemplateGallery({ onCreated, onClose }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const [creating, setCreating] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    safeFetchJson("/api/routing/playbooks/templates")
      .then(res => {
        if (res.ok) setTemplates(res.data?.templates || []);
        else setError("Failed to load templates");
      })
      .catch(() => setError("Failed to load templates"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = activeCategory === "all"
    ? templates
    : templates.filter(t => getTemplateCategory(t) === activeCategory);

  const handleUseTemplate = async (template) => {
    setCreating(template.id);
    try {
      const res = await safeFetchJson("/api/routing/playbooks/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id }),
      });
      if (res.ok) {
        onCreated?.(res.data?.playbook);
      } else {
        setError(res.data?.error || "Failed to create playbook");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-3 min-h-[200px]">
        {[1,2,3].map(i => (
          <div key={i} className="h-20 rounded-xl bg-gray-100 dark:bg-white/5 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">Choose a pre-built routing template to get started quickly.</p>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        {CATEGORY_FILTERS.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
              activeCategory === cat.id
                ? "bg-primary text-white border-primary"
                : "border-border text-text-muted hover:text-text-main"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-3 max-h-[420px] overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="text-center text-text-muted py-8 text-sm">No templates in this category.</p>
        ) : (
          filtered.map(template => (
            <Card key={template.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-sm truncate">{template.name}</h3>
                    <Badge variant="outline" size="sm">{template.trigger?.value || "default"}</Badge>
                  </div>
                  <p className="text-xs text-text-muted line-clamp-2">{template.description}</p>

                  {expandedId === template.id && (
                    <div className="mt-3 border-t pt-3">
                      <p className="text-xs font-medium text-text-muted mb-2">{template.rules?.length || 0} Rules:</p>
                      <div className="flex flex-col gap-1">
                        {(template.rules || []).map((rule, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className={`px-1.5 py-0.5 rounded font-mono ${
                              rule.type === "boost" ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" :
                              rule.type === "stack" ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" :
                              "bg-gray-100 dark:bg-white/10 text-text-muted"
                            }`}>{rule.type}</span>
                            <span className="text-text-muted truncate">{rule.target}</span>
                            {rule.value && typeof rule.value === "number" && (
                              <span className="text-text-muted shrink-0">+{rule.value.toLocaleString()}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className="text-xs text-text-muted">{template.rules?.length || 0} rules</span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpandedId(expandedId === template.id ? null : template.id)}
                    >
                      {expandedId === template.id ? "Hide" : "Preview"}
                    </Button>
                    <Button
                      size="sm"
                      disabled={creating === template.id}
                      onClick={() => handleUseTemplate(template)}
                    >
                      {creating === template.id ? "Creating..." : "Use"}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      <div className="flex justify-end pt-2 border-t">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}
