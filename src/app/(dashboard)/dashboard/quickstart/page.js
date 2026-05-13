"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { safeFetchJson } from "@/shared/utils";

const TABS = [
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "curl", label: "cURL" },
  { id: "cursor", label: "Cursor / VS Code" },
];

function CodeBlock({ code, id, copied, onCopy }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          icon={copied === id ? "check" : "content_copy"}
          onClick={() => onCopy(code, id)}
        >
          {copied === id ? "Copied!" : "Copy"}
        </Button>
      </div>
      <pre className="p-4 bg-black/5 dark:bg-white/5 border border-border rounded-lg font-mono text-xs overflow-x-auto whitespace-pre leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

export default function QuickStartPage() {
  const [activeTab, setActiveTab] = useState("python");
  const [baseUrl, setBaseUrl] = useState("http://localhost:20128/v1");
  const [apiKeyDisplay, setApiKeyDisplay] = useState("YOUR_API_KEY");
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(`${window.location.origin}/v1`);
    }
    safeFetchJson("/api/keys").then(res => {
      const keys = res.data?.keys || [];
      const active = keys.find(k => !k.revoked);
      if (active?.keyPrefix) {
        setApiKeyDisplay(`${active.keyPrefix}...`);
      }
    }).catch(() => {});
  }, []);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const res = await fetch(`${origin}/api/v1/models`);
      const data = await res.json();
      const preview = JSON.stringify(data, null, 2).slice(0, 600);
      setTestResult({ ok: res.ok, data: preview + (preview.length >= 600 ? "\n..." : "") });
    } catch (e) {
      setTestResult({ ok: false, data: e.message });
    } finally {
      setTesting(false);
    }
  };

  const examples = {
    python: [
      {
        label: "openai SDK",
        id: "py-openai",
        code: `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${apiKeyDisplay}",
)

response = client.chat.completions.create(
    model="auto",  # ZippyMesh picks the best model
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)`,
      },
      {
        label: "litellm",
        id: "py-litellm",
        code: `import litellm

response = litellm.completion(
    model="openai/auto",
    api_base="${baseUrl}",
    api_key="${apiKeyDisplay}",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)`,
      },
      {
        label: "LangChain",
        id: "py-langchain",
        code: `from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="auto",
    openai_api_base="${baseUrl}",
    openai_api_key="${apiKeyDisplay}",
)

response = llm.invoke("Hello!")
print(response.content)`,
      },
    ],
    javascript: [
      {
        label: "openai SDK",
        id: "js-openai",
        code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: "${apiKeyDisplay}",
});

const response = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);`,
      },
      {
        label: "Vercel AI SDK",
        id: "js-vercel",
        code: `import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const zippymesh = createOpenAI({
  baseURL: "${baseUrl}",
  apiKey: "${apiKeyDisplay}",
});

const { text } = await generateText({
  model: zippymesh("auto"),
  prompt: "Hello!",
});
console.log(text);`,
      },
    ],
    curl: [
      {
        label: "Basic completion",
        id: "curl-basic",
        code: `curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKeyDisplay}" \\
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
      },
      {
        label: "Streaming",
        id: "curl-stream",
        code: `curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKeyDisplay}" \\
  -d '{
    "model": "auto",
    "stream": true,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
      },
      {
        label: "With routing headers",
        id: "curl-headers",
        code: `curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKeyDisplay}" \\
  -H "X-Intent: code" \\
  -H "X-Prefer-Free: true" \\
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Write a Python hello world"}]
  }'`,
      },
    ],
    cursor: [
      {
        label: "Cursor IDE (settings.json)",
        id: "cursor-settings",
        code: `// Press Ctrl+Shift+P → "Open User Settings (JSON)"
// Add or merge these settings:
{
  "cursor.openaiApiBase": "${baseUrl}",
  "cursor.openaiApiKey": "${apiKeyDisplay}",
  "cursor.preferredModelName": "auto"
}`,
      },
      {
        label: "VS Code (Continue extension)",
        id: "continue-config",
        code: `// ~/.continue/config.json
{
  "models": [
    {
      "title": "ZippyMesh Auto",
      "provider": "openai",
      "model": "auto",
      "apiKey": "${apiKeyDisplay}",
      "apiBase": "${baseUrl}"
    }
  ]
}`,
      },
    ],
  };

  const currentExamples = examples[activeTab] || [];

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Integration Guide</h1>
        <p className="text-sm text-text-muted mt-1">
          Copy-paste examples to connect any OpenAI-compatible tool to ZippyMesh.
        </p>
      </div>

      {/* Connection info */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Your Endpoint</h2>
          <Button
            variant="secondary"
            size="sm"
            icon={testing ? "hourglass_empty" : "wifi_tethering"}
            onClick={handleTestConnection}
            disabled={testing}
          >
            {testing ? "Testing..." : "Test Connection"}
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-text-muted mb-1">Base URL</p>
            <code className="block font-mono text-xs bg-black/5 dark:bg-white/5 px-3 py-2 rounded-lg break-all">
              {baseUrl}
            </code>
          </div>
          <div>
            <p className="text-xs text-text-muted mb-1">API Key</p>
            <div className="flex items-center gap-2">
              <code className="font-mono text-xs bg-black/5 dark:bg-white/5 px-3 py-2 rounded-lg flex-1">
                {apiKeyDisplay}
              </code>
              <a href="/dashboard/endpoint" className="text-xs text-primary hover:underline shrink-0">
                Manage keys
              </a>
            </div>
          </div>
        </div>

        {testResult && (
          <div className={`mt-4 p-3 rounded-lg text-xs font-mono ${
            testResult.ok
              ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
              : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
          }`}>
            <div className="flex items-center gap-2 mb-1 font-sans font-semibold">
              <span className="material-symbols-outlined text-sm">
                {testResult.ok ? "check_circle" : "error"}
              </span>
              {testResult.ok ? "Connection successful" : "Connection failed"}
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap">{testResult.data}</pre>
          </div>
        )}
      </Card>

      {/* Code examples */}
      <Card>
        <div className="flex gap-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit mb-6 flex-wrap">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-white dark:bg-gray-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-6">
          {currentExamples.map(({ label, id, code }) => (
            <div key={id}>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">{label}</p>
              <CodeBlock code={code} id={id} copied={copied} onCopy={copy} />
            </div>
          ))}
        </div>
      </Card>

      {/* Routing headers tip */}
      <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 p-4 flex gap-3">
        <span className="material-symbols-outlined text-blue-500 shrink-0 mt-0.5">tips_and_updates</span>
        <div className="text-sm">
          <p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Smart Routing Headers</p>
          <p className="text-text-muted">
            Add <code className="font-mono text-xs bg-blue-100 dark:bg-blue-900/30 px-1 rounded">X-Intent: code</code> or{" "}
            <code className="font-mono text-xs bg-blue-100 dark:bg-blue-900/30 px-1 rounded">X-Prefer-Free: true</code>{" "}
            to control routing. See{" "}
            <a href="/dashboard/endpoint" className="underline text-blue-600 dark:text-blue-400">
              API Server
            </a>{" "}
            for all available headers.
          </p>
        </div>
      </div>
    </div>
  );
}
