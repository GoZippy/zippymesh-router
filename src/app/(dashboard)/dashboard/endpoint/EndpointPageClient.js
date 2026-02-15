"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Modal, CardSkeleton } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState(null);
  const [showSnippets, setShowSnippets] = useState(null);

  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const keysRes = await fetch("/api/keys");
      const keysData = await keysRes.json();
      if (keysRes.ok) {
        setKeys(keysData.keys || []);
      }
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        setNewKeyName("");
        setShowAddModal(false);
      }
    } catch (error) {
      console.log("Error creating key:", error);
    }
  };

  const handleDeleteKey = async (id) => {
    if (!confirm("Delete this API key?")) return;

    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        setKeys(keys.filter((k) => k.id !== id));
      }
    } catch (error) {
      console.log("Error deleting key:", error);
    }
  };

  const [baseUrl, setBaseUrl] = useState("/v1");

  // Hydration fix: Only access window on client side
  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(`${window.location.origin}/v1`);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Endpoint Card */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">API Endpoint</h2>
            <p className="text-sm text-text-muted">Local Server</p>
          </div>
        </div>

        {/* Endpoint URL */}
        <div className="flex gap-2 mb-3">
          <Input
            value={baseUrl}
            readOnly
            className="flex-1 font-mono text-sm"
          />
          <Button
            variant="secondary"
            icon={copied === "endpoint_url" ? "check" : "content_copy"}
            onClick={() => copy(baseUrl, "endpoint_url")}
          >
            {copied === "endpoint_url" ? "Copied!" : "Copy"}
          </Button>
        </div>
      </Card>

      {/* API Keys */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">API Keys</h2>
          <Button icon="add" onClick={() => setShowAddModal(true)}>
            Create Key
          </Button>
        </div>

        {keys.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">vpn_key</span>
            </div>
            <p className="text-text-main font-medium mb-1">No API keys yet</p>
            <p className="text-sm text-text-muted mb-4">Create your first API key to get started</p>
            <Button icon="add" onClick={() => setShowAddModal(true)}>
              Create Key
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            {keys.map((key) => (
              <div
                key={key.id}
                className="group flex items-center justify-between py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{key.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs text-text-muted font-mono">{key.key}</code>
                    <button
                      onClick={() => copy(key.key, key.id)}
                      className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {copied === key.id ? "check" : "content_copy"}
                      </span>
                    </button>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => handleDeleteKey(key.id)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Connect to Tools</h2>
          <p className="text-sm text-text-muted">Integration Snippets</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-bg/50">
            <h3 className="font-medium text-sm">OpenClaw</h3>
            <p className="text-xs text-text-muted mb-2">Resilient OpenAI-compatible gateway</p>
            <Button size="sm" variant="secondary" icon="code" onClick={() => setShowSnippets("openclaw")}>
              Get Config
            </Button>
          </div>
          <div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-bg/50">
            <h3 className="font-medium text-sm">VS Code (Continue)</h3>
            <p className="text-xs text-text-muted mb-2">Use ZippyMesh for local development</p>
            <Button size="sm" variant="secondary" icon="code" onClick={() => setShowSnippets("continue")}>
              Get Config
            </Button>
          </div>
        </div>
      </Card>

      {/* Snippet Modal */}
      {showSnippets && (
        <Modal
          isOpen={!!showSnippets}
          onClose={() => setShowSnippets(null)}
          title={`Integration: ${showSnippets === 'openclaw' ? 'OpenClaw' : 'Continue (VS Code)'}`}
          size="xl"
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-text-muted">
                {showSnippets === 'openclaw' ? 'openclaw.json' : 'config.json'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={copied === "snippet" ? "check" : "content_copy"}
                onClick={() => {
                  const content = showSnippets === 'openclaw'
                    ? `{\n  "zippymesh": {\n    "baseUrl": "${baseUrl}",\n    "apiKey": "${keys[0]?.key || 'YOUR_KEY'}",\n    "api": "openai-completions",\n    "models": [\n      {\n        "id": "auto",\n        "name": "ZippyMesh Auto",\n        "contextWindow": 128000\n      }\n    ]\n  }\n}`
                    : `{\n  "models": [\n    {\n      "title": "ZippyMesh",\n      "provider": "openai",\n      "model": "zippymesh/auto",\n      "apiKey": "${keys[0]?.key || 'YOUR_KEY'}",\n      "apiBase": "${baseUrl}"\n    }\n  ]\n}`;
                  copy(content, "snippet");
                }}
              >
                {copied === "snippet" ? "Copied!" : "Copy Snippet"}
              </Button>
            </div>
            <pre className="p-4 bg-black/5 dark:bg-white/5 border border-border rounded font-mono text-xs overflow-x-auto">
              {showSnippets === 'openclaw'
                ? `{\n  "zippymesh": {\n    "baseUrl": "${baseUrl}",\n    "apiKey": "${keys[0]?.key || 'YOUR_KEY'}",\n    "api": "openai-completions",\n    "models": [\n      {\n        "id": "auto",\n        "name": "ZippyMesh Auto",\n        "contextWindow": 128000\n      }\n    ]\n  }\n}`
                : `{\n  "models": [\n    {\n      "title": "ZippyMesh",\n      "provider": "openai",\n      "model": "zippymesh/auto",\n      "apiKey": "${keys[0]?.key || 'YOUR_KEY'}",\n      "apiBase": "${baseUrl}"\n    }\n  ]\n}`}
            </pre>
          </div>
        </Modal>
      )}

      {/* Add Key Modal */}
      <Modal
        isOpen={showAddModal}
        title="Create API Key"
        onClose={() => {
          setShowAddModal(false);
          setNewKeyName("");
        }}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
          />
          <div className="flex gap-2">
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()}>
              Create
            </Button>
            <Button
              onClick={() => {
                setShowAddModal(false);
                setNewKeyName("");
              }}
              variant="ghost"
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Created Key Modal */}
      <Modal
        isOpen={!!createdKey}
        title="API Key Created"
        onClose={() => setCreatedKey(null)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
              Save this key now!
            </p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              This is the only time you will see this key. Store it securely.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={createdKey || ""}
              readOnly
              className="flex-1 font-mono text-sm"
            />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey, "created_key")}
            >
              {copied === "created_key" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Button onClick={() => setCreatedKey(null)} fullWidth>
            Done
          </Button>
        </div>
      </Modal>
    </div>
  );
}

APIPageClient.propTypes = {
  machineId: PropTypes.string.isRequired,
};