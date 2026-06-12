"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Modal, CardSkeleton } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { formatRequestError, safeFetchJson } from "@/shared/utils";

const KEY_MASK = "zm_••••••••••••••••";

export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState(null);
  const [showSnippets, setShowSnippets] = useState(null);
  const [revealKey, setRevealKey] = useState(false);
  const [regenerating, setRegenerating] = useState(null);
  const [createdKeyIsRegenerated, setCreatedKeyIsRegenerated] = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);

  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const response = await safeFetchJson("/api/keys");
      const keysData = response.data || {};
      if (response.ok) {
        setKeys(keysData.keys || []);
      } else {
        console.error(formatRequestError("Failed to fetch keys", response, "Failed to fetch keys"));
      }
    } catch (error) {
      console.error(formatRequestError("Error fetching data", error));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const response = await safeFetchJson("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = response.data || {};

      if (response.ok) {
        setCreatedKey(data.key);
        setRevealKey(true);
        setCreatedKeyIsRegenerated(false);
        await fetchData();
        setNewKeyName("");
        setShowAddModal(false);
      } else {
        console.error(formatRequestError("Failed to create key", response, "Failed to create key"));
      }
    } catch (error) {
      console.error(formatRequestError("Error creating key", error));
    }
  };

  const handleDeleteKey = async (id) => {
    if (!confirm("Delete this API key?")) return;

    try {
      const response = await safeFetchJson(`/api/keys/${id}`, { method: "DELETE" });
      if (response.ok) {
        setKeys(keys.filter((k) => k.id !== id));
      } else {
        console.error(formatRequestError("Failed to delete key", response, "Failed to delete key"));
      }
    } catch (error) {
      console.error(formatRequestError("Error deleting key", error));
    }
  };

  const handleRegenerateKey = async (keyRecord) => {
    if (!confirm("Regenerate this key? The old key will stop working. You will see the new key once—copy it for your bots and tools.")) return;

    setRegenerating(keyRecord.id);
    try {
      const response = await safeFetchJson(`/api/keys/${keyRecord.id}/regenerate`, { method: "POST" });
      const data = response.data || {};
      if (!response.ok) {
        throw new Error(formatRequestError("Failed to regenerate key", response, data.error || "Failed to regenerate key"));
      }

      const rawKey = data.key;
      if (!rawKey || typeof rawKey !== "string") {
        throw new Error("No key returned from regenerate");
      }

      setCreatedKey(rawKey);
      setRevealKey(true);
      setCreatedKeyIsRegenerated(true);
      await fetchData();
    } catch (error) {
      console.log("Error regenerating key:", error);
      alert(error.message || "Failed to regenerate key");
    } finally {
      setRegenerating(null);
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
            {keys.filter((k) => !k.revoked).map((key) => (
              <div
                key={key.id}
                className="group flex items-center justify-between py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{key.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs text-text-muted font-mono">{KEY_MASK}</code>
                    <span className="text-xs text-text-muted" title="Keys are stored securely and cannot be retrieved. Use Regenerate to get a new key.">
                      <span className="material-symbols-outlined text-[14px] align-middle">info</span>
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleRegenerateKey(key)}
                    disabled={regenerating === key.id}
                    className="p-2 hover:bg-primary/10 rounded text-primary"
                    title="Regenerate key — get a new key to copy (old key will stop working)"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {regenerating === key.id ? "hourglass_empty" : "refresh"}
                    </span>
                  </button>
                  <button
                    onClick={() => handleDeleteKey(key.id)}
                    className="p-2 hover:bg-red-500/10 rounded text-red-500 opacity-70 hover:opacity-100"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
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

      {/* Advanced Routing Headers */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold">Advanced Routing Headers</h2>
            <p className="text-sm text-text-muted">Pass these request headers to control how ZippyMesh routes your request</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={showHeaders ? "expand_less" : "expand_more"}
            onClick={() => setShowHeaders(h => !h)}
          >
            {showHeaders ? "Hide" : "Show"}
          </Button>
        </div>

        {showHeaders && (
          <div className="flex flex-col gap-3 mt-3">
            {[
              {
                header: "X-Intent",
                type: "string",
                values: "code · reasoning · vision · embedding · fast · default",
                description: "Override intent detection. ZippyMesh auto-detects intent from your messages, but you can set it explicitly to guarantee the right model family is selected.",
                example: 'X-Intent: code',
              },
              {
                header: "X-Max-Latency-Ms",
                type: "number (ms)",
                values: "e.g. 2000",
                description: "Maximum acceptable response latency in milliseconds. Models with average latency above this threshold will be deprioritized.",
                example: 'X-Max-Latency-Ms: 2000',
              },
              {
                header: "X-Max-Cost-Per-M-Tokens",
                type: "number (USD)",
                values: "e.g. 5.00",
                description: "Maximum cost per million tokens (input + output combined). Models priced above this will be filtered out of routing candidates.",
                example: 'X-Max-Cost-Per-M-Tokens: 5.00',
              },
              {
                header: "X-Min-Context-Window",
                type: "number (tokens)",
                values: "e.g. 32000",
                description: "Minimum context window size required. Use this when your request contains long documents that need a large context.",
                example: 'X-Min-Context-Window: 32000',
              },
              {
                header: "X-Prefer-Free",
                type: "boolean",
                values: "true · false",
                description: "When set to true, ZippyMesh will route only to free-tier models (e.g. Groq free, OpenRouter free). Paid models will be excluded unless no free models are available.",
                example: 'X-Prefer-Free: true',
              },
              {
                header: "X-Prefer-Local",
                type: "boolean",
                values: "true · false",
                description: "When true, routes to locally-running models first (Ollama, LM Studio). Falls back to cloud providers if no local models are available.",
                example: 'X-Prefer-Local: true',
              },
            ].map(({ header, type, values, description, example }) => (
              <div key={header} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded">{header}</code>
                    <span className="text-xs text-text-muted">{type}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied === header ? "check" : "content_copy"}
                    onClick={() => copy(example, header)}
                  >
                    {copied === header ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="text-xs text-text-muted mb-1">Values: <span className="font-mono">{values}</span></p>
                <p className="text-sm text-text-main">{description}</p>
                <pre className="mt-2 p-2 bg-black/5 dark:bg-white/5 rounded text-xs font-mono text-text-muted overflow-x-auto">{example}</pre>
              </div>
            ))}

            <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-4">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1">Example: Route to a free coding model</p>
              <pre className="text-xs font-mono text-text-muted overflow-x-auto whitespace-pre-wrap">{`curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "X-Intent: code" \\
  -H "X-Prefer-Free: true" \\
  -d '{"model":"auto","messages":[{"role":"user","content":"Write a Python hello world"}]}'`}</pre>
            </div>
          </div>
        )}
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

      {/* Created/Regenerated Key Modal */}
      <Modal
        isOpen={!!createdKey}
        title={createdKeyIsRegenerated ? "API Key Regenerated" : "API Key Created"}
        onClose={() => { setCreatedKey(null); setRevealKey(false); setCreatedKeyIsRegenerated(false); }}
        closeOnOverlay={false}
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
            <div className="flex-1 relative">
              <Input
                value={revealKey ? (createdKey || "") : KEY_MASK}
                readOnly
                type={revealKey ? "text" : "password"}
                className="font-mono text-sm pr-10"
              />
              <button
                type="button"
                onClick={() => setRevealKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-primary rounded"
                title={revealKey ? "Hide" : "Reveal"}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {revealKey ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => typeof createdKey === "string" && copy(createdKey, "created_key")}
            >
              {copied === "created_key" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Button onClick={() => { setCreatedKey(null); setRevealKey(false); setCreatedKeyIsRegenerated(false); }} fullWidth>
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