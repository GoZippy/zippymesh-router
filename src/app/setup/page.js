"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

// ─── Step definitions ────────────────────────────────────────────────────────

const STEPS = [
  { id: "security",  title: "Set a password",       icon: "shield",         desc: "Protect your dashboard with a password." },
  { id: "provider",  title: "Connect a provider",   icon: "hub",            desc: "Add at least one LLM provider so requests can be routed." },
  { id: "test",      title: "Test your endpoint",   icon: "terminal",       desc: "Confirm the router is working with a quick request." },
  { id: "vault",     title: "Secure your keys",     icon: "security",       desc: "Optional: store provider API keys in ZippyVault (encrypted)." },
  { id: "done",      title: "All set!",             icon: "check_circle",   desc: "You're ready to start routing." },
];

// ─── Quick-connect provider cards ────────────────────────────────────────────

const QUICK_PROVIDERS = [
  {
    id: "kilo",
    name: "Kilo.ai",
    badge: "Free tier",
    badgeColor: "green",
    icon: null,
    textIcon: "KL",
    color: "#6366F1",
    time: "~1 min",
    description: "Budget & free models via the Kilo AI Gateway. Just paste an API key — works immediately.",
    steps: [
      { text: "Go to", link: { label: "app.kilo.ai/profile", href: "https://app.kilo.ai/profile" } },
      { text: "Copy your API key" },
      { text: "Come back and add Kilo.ai as a provider (API Key type)" },
    ],
    providersLink: "/dashboard/providers",
    providerFilter: "kilo",
  },
  {
    id: "github",
    name: "GitHub Copilot",
    badge: "No secrets needed",
    badgeColor: "blue",
    icon: null,
    textIcon: "GH",
    color: "#333333",
    time: "~2 min",
    description: "Device-code OAuth flow — no client secrets required. Needs an active GitHub Copilot subscription.",
    steps: [
      { text: "Open the Providers page" },
      { text: "Click GitHub Copilot → Connect" },
      { text: "Approve the device-code in your browser" },
    ],
    providersLink: "/dashboard/providers",
    providerFilter: "github",
  },
  {
    id: "antigravity",
    name: "Antigravity / Gemini Code Assist",
    badge: "OAuth",
    badgeColor: "purple",
    icon: null,
    textIcon: "AG",
    color: "#7C3AED",
    time: "~5 min",
    description: "OAuth with a Google account. Requires setting ANTIGRAVITY_CLIENT_ID and ANTIGRAVITY_CLIENT_SECRET in your .env file first.",
    steps: [
      { text: "Add client credentials to your .env file" },
      { text: "Restart the server" },
      { text: "Click Antigravity → Connect → Authorize with Google" },
    ],
    providersLink: "/dashboard/providers",
    providerFilter: "antigravity",
  },
];

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepDots({ current, total }) {
  return (
    <div className="flex items-center gap-2 justify-center mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-2 rounded-full transition-all duration-300",
            i === current
              ? "w-6 bg-primary"
              : i < current
              ? "w-2 bg-primary/40"
              : "w-2 bg-black/10 dark:bg-white/10"
          )}
        />
      ))}
    </div>
  );
}

// ─── Step 0: Security ─────────────────────────────────────────────────────────

function StepSecurity({ onNext }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to set password.");
      }
      onNext();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Choose a dashboard password. You can change it any time in{" "}
        <strong>Settings → Profile</strong>.
      </p>
      <Input
        type="password"
        label="Password"
        placeholder="At least 4 characters"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoFocus
      />
      <Input
        type="password"
        label="Confirm password"
        placeholder="Repeat your password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
      />
      {error && (
        <p className="text-sm text-red-500 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">error</span>
          {error}
        </p>
      )}
      <Button type="submit" loading={loading} fullWidth>
        Continue
      </Button>
    </form>
  );
}

// ─── Step 1: Connect a provider ───────────────────────────────────────────────

function StepProvider({ onNext, onSkip }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(null);

  const BADGE_COLORS = {
    green:  "bg-green-100  dark:bg-green-900/30  text-green-700  dark:text-green-300  border-green-200  dark:border-green-800",
    blue:   "bg-blue-100   dark:bg-blue-900/30   text-blue-700   dark:text-blue-300   border-blue-200   dark:border-blue-800",
    purple: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        ZippyMesh routes your requests across multiple LLM providers. Add at
        least one to get started. The three easiest options are below.
      </p>

      <div className="flex flex-col gap-3">
        {QUICK_PROVIDERS.map((provider) => {
          const isOpen = expanded === provider.id;
          return (
            <div
              key={provider.id}
              className={cn(
                "rounded-lg border transition-colors",
                isOpen
                  ? "border-primary/40 bg-primary/5"
                  : "border-black/10 dark:border-white/10 bg-surface hover:border-primary/30"
              )}
            >
              {/* Header row */}
              <button
                type="button"
                className="w-full flex items-center gap-3 p-4 text-left"
                onClick={() => setExpanded(isOpen ? null : provider.id)}
              >
                {/* Icon */}
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-white text-xs font-bold"
                  style={{ backgroundColor: provider.color }}
                >
                  {provider.textIcon}
                </div>

                {/* Name + badge */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{provider.name}</span>
                    <span
                      className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                        BADGE_COLORS[provider.badgeColor]
                      )}
                    >
                      {provider.badge}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-0.5 truncate">
                    Setup time: {provider.time}
                  </p>
                </div>

                <span
                  className={cn(
                    "material-symbols-outlined text-text-muted transition-transform",
                    isOpen && "rotate-180"
                  )}
                >
                  expand_more
                </span>
              </button>

              {/* Expanded content */}
              {isOpen && (
                <div className="px-4 pb-4 flex flex-col gap-3 border-t border-black/5 dark:border-white/5">
                  <p className="text-sm text-text-muted pt-3">
                    {provider.description}
                  </p>

                  <ol className="flex flex-col gap-1.5">
                    {provider.steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-text-muted">
                          {step.text}
                          {step.link && (
                            <>
                              {" "}
                              <a
                                href={step.link.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline inline-flex items-center gap-0.5"
                              >
                                {step.link.label}
                                <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                              </a>
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>

                  <Button
                    size="sm"
                    icon="arrow_forward"
                    iconPosition="right"
                    onClick={() => router.push(provider.providersLink)}
                  >
                    Go to Providers page
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 pt-2">
        <Button onClick={onNext} fullWidth variant="primary" icon="check">
          I&apos;ve connected a provider — continue
        </Button>
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-text-muted hover:text-text-main text-center py-1 hover:underline"
        >
          Skip for now (add providers later)
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Test endpoint ────────────────────────────────────────────────────

const CURL_CMD = `curl -X POST http://localhost:20128/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello!"}]}'`;

function StepTest({ onNext }) {
  const [testState, setTestState] = useState("idle"); // idle | loading | success | error
  const [response, setResponse] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CURL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API might not be available
    }
  };

  const handleTest = async () => {
    setTestState("loading");
    setResponse(null);
    try {
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "auto",
          messages: [{ role: "user", content: "Hello! Just reply with one short sentence." }],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const content =
          data?.choices?.[0]?.message?.content ||
          data?.choices?.[0]?.text ||
          JSON.stringify(data).slice(0, 200);
        setResponse({ ok: true, content, model: data?.model });
        setTestState("success");
      } else {
        setResponse({ ok: false, content: data?.error?.message || data?.error || JSON.stringify(data).slice(0, 200) });
        setTestState("error");
      }
    } catch (err) {
      setResponse({ ok: false, content: err.message });
      setTestState("error");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Confirm your router is working. Click <strong>Test Now</strong> to send
        a quick request through the router, or copy the curl command to run it
        yourself.
      </p>

      {/* Curl command block */}
      <div className="relative rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 p-4">
        <pre className="text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
          {CURL_CMD}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-3 right-3 text-text-muted hover:text-text-main transition-colors"
          title="Copy to clipboard"
        >
          <span className="material-symbols-outlined text-[18px]">
            {copied ? "check" : "content_copy"}
          </span>
        </button>
      </div>

      {/* Test result */}
      {testState === "success" && response && (
        <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-green-500 text-[18px]">check_circle</span>
            <span className="text-sm font-semibold text-green-600 dark:text-green-400">
              It works!{response.model ? ` (routed to ${response.model})` : ""}
            </span>
          </div>
          <p className="text-sm text-text-muted font-mono leading-relaxed">
            {response.content}
          </p>
        </div>
      )}

      {testState === "error" && response && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-red-500 text-[18px]">error</span>
            <span className="text-sm font-semibold text-red-600 dark:text-red-400">
              Request failed
            </span>
          </div>
          <p className="text-sm text-text-muted font-mono leading-relaxed">
            {response.content}
          </p>
          <p className="text-xs text-text-muted mt-2">
            Make sure you have at least one active provider connected.{" "}
            <a href="/dashboard/providers" className="text-primary hover:underline">
              Go to Providers
            </a>
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Button
          onClick={handleTest}
          loading={testState === "loading"}
          fullWidth
          variant={testState === "success" ? "secondary" : "primary"}
          icon="send"
        >
          {testState === "loading" ? "Testing…" : testState === "success" ? "Test again" : "Test Now"}
        </Button>

        <Button onClick={onNext} fullWidth variant={testState === "success" ? "primary" : "ghost"}>
          {testState === "success" ? "Continue" : "Skip — I'll test manually"}
        </Button>
      </div>
    </div>
  );
}

// ─── Step 3: Vault (optional) ────────────────────────────────────────────────

function StepVault({ onNext, onSkip }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
        <span className="material-symbols-outlined text-primary text-xl mt-0.5 shrink-0">security</span>
        <div>
          <p className="text-sm font-semibold text-text-main mb-1">ZippyVault — optional</p>
          <p className="text-sm text-text-muted leading-relaxed">
            Store your provider API keys in an encrypted local vault. Keys are protected with
            AES-256-GCM encryption and a password only you know — they never leave your machine.
          </p>
          <p className="text-sm text-text-muted leading-relaxed mt-1">
            When the vault is unlocked, ZippyMesh automatically uses your stored keys as a
            fallback if a provider connection has no API key configured.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border divide-y divide-border text-sm">
        <div className="flex items-center gap-3 p-3">
          <span className="material-symbols-outlined text-green-400 text-[18px]">check</span>
          <span className="text-text-muted">AES-256-GCM encryption, PBKDF2 key derivation</span>
        </div>
        <div className="flex items-center gap-3 p-3">
          <span className="material-symbols-outlined text-green-400 text-[18px]">check</span>
          <span className="text-text-muted">Keys stored locally only — never transmitted</span>
        </div>
        <div className="flex items-center gap-3 p-3">
          <span className="material-symbols-outlined text-green-400 text-[18px]">check</span>
          <span className="text-text-muted">Accessible later at Dashboard → Vault</span>
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onSkip} fullWidth>
          Skip for now
        </Button>
        <Button onClick={onNext} fullWidth icon="arrow_forward" iconPosition="right">
          Set up Vault
        </Button>
      </div>
    </div>
  );
}

// ─── Step 4: Done ────────────────────────────────────────────────────────────

function StepDone({ onFinish, loading }) {
  return (
    <div className="flex flex-col items-center gap-6 py-2 text-center">
      <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
        <span className="material-symbols-outlined text-green-500 text-4xl">check_circle</span>
      </div>

      <div>
        <h2 className="text-xl font-bold mb-2">ZippyMesh is ready</h2>
        <p className="text-sm text-text-muted max-w-sm mx-auto">
          Your router is set up and ready to accept requests at{" "}
          <code className="font-mono bg-black/5 dark:bg-white/5 px-1 rounded">
            http://localhost:20128/v1/
          </code>
          .
        </p>
      </div>

      <div className="w-full rounded-lg border border-black/10 dark:border-white/10 divide-y divide-black/5 dark:divide-white/5 text-left">
        <div className="flex items-center gap-3 p-3">
          <span className="material-symbols-outlined text-primary text-[20px]">dns</span>
          <div>
            <p className="text-sm font-medium">Add more providers</p>
            <p className="text-xs text-text-muted">Dashboard → Providers</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3">
          <span className="material-symbols-outlined text-primary text-[20px]">terminal</span>
          <div>
            <p className="text-sm font-medium">Point your CLI tools here</p>
            <p className="text-xs text-text-muted">Dashboard → CLI Tools</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3">
          <span className="material-symbols-outlined text-primary text-[20px]">bar_chart</span>
          <div>
            <p className="text-sm font-medium">Monitor usage & cost</p>
            <p className="text-xs text-text-muted">Dashboard → Usage</p>
          </div>
        </div>
      </div>

      <Button onClick={onFinish} loading={loading} fullWidth size="lg" icon="arrow_forward" iconPosition="right">
        Go to Dashboard
      </Button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState("");
  const router = useRouter();

  const currentStep = STEPS[step];

  async function finish() {
    setFinishing(true);
    setFinishError("");
    try {
      const res = await fetch("/api/setup/complete", { method: "POST" });
      if (!res.ok) throw new Error("Failed to complete setup.");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setFinishError(err.message);
      setFinishing(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-lg">
        {/* Logo / title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary">Zippy Mesh Router</h1>
          <p className="text-sm text-text-muted mt-1">
            Set up takes about 5 minutes
          </p>
        </div>

        {/* Step dots */}
        <StepDots current={step} total={STEPS.length} />

        {/* Card */}
        <Card>
          {/* Step header */}
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[22px]">
                {currentStep.icon}
              </span>
            </div>
            <div>
              <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
                Step {step + 1} of {STEPS.length}
              </p>
              <h2 className="text-lg font-bold">{currentStep.title}</h2>
            </div>
          </div>

          {/* Step content */}
          {step === 0 && (
            <StepSecurity onNext={() => setStep(1)} />
          )}
          {step === 1 && (
            <StepProvider
              onNext={() => setStep(2)}
              onSkip={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <StepTest onNext={() => setStep(3)} />
          )}
          {step === 3 && (
            <StepVault
              onNext={() => { router.push("/dashboard/vault-keys?setup=1"); }}
              onSkip={() => setStep(4)}
            />
          )}
          {step === 4 && (
            <>
              <StepDone onFinish={finish} loading={finishing} />
              {finishError && (
                <p className="text-sm text-red-500 text-center mt-2">{finishError}</p>
              )}
            </>
          )}
        </Card>

        {/* Skip entire setup */}
        {step < 3 && (
          <p className="mt-4 text-center text-sm text-text-muted">
            Already set up?{" "}
            <a href="/dashboard" className="hover:underline text-primary">
              Skip to dashboard
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
