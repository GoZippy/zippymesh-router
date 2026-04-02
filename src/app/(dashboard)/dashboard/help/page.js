"use client";

import Link from "next/link";
import { Card, Button } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useRef, useState } from "react";

const ROUTING_CONCEPTS = [
  {
    title: "Routing Modes",
    icon: "alt_route",
    description:
      "Choose how ZippyMesh decides the first model to try before any failover happens.",
    details:
      "Think of this as the strategy layer. In AUTO mode, intent is inferred from context and the engine chooses playbooks and pools before default scoring. In PLAYBOOK mode, your selected playbook rules are applied directly. In DEFAULT mode, it uses a simpler cost/latency strategy without auto playbook logic.",
    configureAt: "/dashboard/routing",
    example:
      'Use AUTO for most users, PLAYBOOK when you want explicit policy, DEFAULT for predictable cost/latency behavior.',
  },
  {
    title: "Routing Playbooks",
    icon: "menu_book",
    description:
      "Named rule sets that influence model scoring and filtering for specific scenarios.",
    details:
      "Playbooks can filter providers, boost or penalize models, enforce cheapest/fastest preferences, or define explicit stack (failover) behavior. They are selected by triggers (intent/client/device/group/pool) in AUTO mode and can also be referenced directly by name.",
    configureAt: "/dashboard/routing",
    example:
      "Route coding requests to Claude/Qwen/DeepSeek while keeping casual chats on low-cost models.",
  },
  {
    title: "Pools (Account Pools)",
    icon: "groups",
    description:
      "A pool is the set of active provider connections, grouped and prioritized for routing.",
    details:
      "The Global Account Pool defines which provider accounts participate, their group (personal/work/team/default), and priority/order. It is also a trigger source for playbooks in AUTO mode.",
    configureAt: "/dashboard/pools",
    example:
      "Keep personal budget models separate from work-critical connections, then route by pool preference.",
  },
  {
    title: "Model Combos",
    icon: "layers",
    description:
      "Named ordered lists of models for deterministic failover at request time.",
    details:
      "Send `model: \"your-combo-name\"` and ZippyMesh will try each model in order until one responds. Combos are the easiest way to guarantee service continuity for a given workload.",
    configureAt: "/dashboard/combos",
    example:
      "Create `fast-fallback` -> `groq/...` → `openai/...` → `anthropic/...` and no client-side code changes are needed.",
  },
];

const ROUTING_PATHS = [
  { label: "Providers", href: "/dashboard/providers", why: "Add and test provider connections." },
  { label: "Pools", href: "/dashboard/pools", why: "Group, prioritize, and enable/disable providers." },
  { label: "Routing", href: "/dashboard/routing", why: "Select mode, limits, and playbook rules." },
  { label: "Combos", href: "/dashboard/combos", why: "Create ordered model failover chains." },
  { label: "Usage", href: "/dashboard/usage", why: "Inspect request patterns and where traffic went." },
  { label: "Analytics", href: "/dashboard/analytics", why: "Compare cost/latency and model behavior over time." },
  { label: "Endpoint", href: "/dashboard/endpoint", why: "Review API endpoint details for integration." },
  { label: "Settings", href: "/dashboard/profile", why: "Global routing toggles and API key/security options." },
];

const COPY_SUMMARY_TEXT = `Request
  └─> Routing Mode + Intent
      └─> Playbook/Pools
          └─> Candidate scoring (cost/latency/health)
              └─> Model attempt
                  └─> Failover to next candidate (Combos / cross-provider chain)`;

const API_EXAMPLES = [
  {
    id: "api-example-playbook",
    title: "Playbook-based routing",
    code: `{
  "model": "zippymesh/code-focus",
  "messages": [{ "role": "user", "content": "Refactor this function." }]
}`,
  },
  {
    id: "api-example-combo",
    title: "Combo-based failover",
    code: `{
  "model": "fast-fallback",
  "messages": [{ "role": "user", "content": "Write a summary in 3 bullets." }]
}`,
  },
];

const TAB_OPTIONS = [
  { id: "overview", label: "Overview" },
  { id: "behavior", label: "How it works" },
  { id: "api", label: "API examples" },
];

const TROUBLESHOOTING_LINKS = [
  { href: "/dashboard/providers", label: "Provider is rate-limited or unavailable", icon: "error", why: "Check /dashboard/providers for status and reset rate limits." },
  { href: "/dashboard/routing", label: "Routing mode/pool mismatch", icon: "refresh", why: "Review mode, pool, and playbook settings in Routing." },
  { href: "/dashboard/combos", label: "Combo falls back too slowly", icon: "layers", why: "Verify combo order and model availability in Combos." },
  { href: "/dashboard/usage", label: "Unexpected traffic pattern", icon: "bar_chart", why: "Inspect request volume and model usage in Usage." },
];

const SUPPORT_URL = "https://zippymesh.com/support?source=zmlr";
const SUPPORT_EMAIL = "support@gozippy.com";

function openReportBugMailto() {
  const shortId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const subject = encodeURIComponent(`[ZMLR Beta] Bug or feedback - TICKET-${shortId}`);
  const body = encodeURIComponent(
    "Describe what happened or what you'd like to report:\n\n\nSteps to reproduce (if applicable):\n\n\nApp version: (see Help page or dashboard)\n\n—\nTicket ref: TICKET-" + shortId
  );
  window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

export default function HelpPage() {
  const { copied, copy } = useCopyToClipboard();
  const [activeTab, setActiveTab] = useState("overview");
  const tabRefs = useRef({});

  const setActiveTabAndFocus = (tabId) => {
    setActiveTab(tabId);
    requestAnimationFrame(() => {
      tabRefs.current[tabId]?.focus();
    });
  };

  const handleTabKeyDown = (event) => {
    const currentIndex = TAB_OPTIONS.findIndex((tab) => tab.id === activeTab);
    if (currentIndex === -1) return;

    if (event.key === "ArrowRight") {
      event.preventDefault();
      const nextIndex = (currentIndex + 1) % TAB_OPTIONS.length;
      setActiveTabAndFocus(TAB_OPTIONS[nextIndex].id);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const prevIndex = (currentIndex - 1 + TAB_OPTIONS.length) % TAB_OPTIONS.length;
      setActiveTabAndFocus(TAB_OPTIONS[prevIndex].id);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setActiveTabAndFocus(TAB_OPTIONS[0].id);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setActiveTabAndFocus(TAB_OPTIONS[TAB_OPTIONS.length - 1].id);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Help & Documentation</h1>
        <p className="text-sm text-text-muted mt-1">
          ZippyMesh Routing is built in layers: routing policy (Modes), candidate control (Playbooks/Pools), and safety fallback (Combos + failover).{" "}
          Start with <Link href="/dashboard/about" className="text-primary hover:underline">About</Link> for a concise overview.
        </p>
      </div>

      <Card
        className="flex gap-2 bg-black/5 dark:bg-white/10 p-1 rounded-lg w-fit"
        role="tablist"
        aria-label="Help documentation sections"
      >
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            ref={(el) => {
              tabRefs.current[tab.id] = el;
            }}
            tabIndex={activeTab === tab.id ? 0 : -1}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            onKeyDown={handleTabKeyDown}
            onClick={() => setActiveTabAndFocus(tab.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === tab.id
              ? "bg-white dark:bg-gray-800 shadow-sm"
              : "text-text-muted hover:text-text-main"
              }`}
          >
            {tab.label}
          </button>
        ))}
      </Card>

      <Card className="flex flex-col gap-2 text-sm text-text-muted">
        <h2 className="font-semibold text-lg">Need help?</h2>
        <p className="text-sm text-text-muted">Use this checklist when behavior looks wrong:</p>
        <div className="space-y-2 text-sm text-text-muted">
          {TROUBLESHOOTING_LINKS.map((item) => (
            <p key={item.href} className="flex items-start gap-2">
              <span className="material-symbols-outlined leading-none mt-0.5 text-text-muted">{item.icon}</span>
              <span>
                <Link href={item.href} className="text-primary hover:underline font-medium">
                  {item.label}
                </Link>
                <span className="ml-1">— {item.why}</span>
              </span>
            </p>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 text-sm text-text-muted border-primary/20">
        <h2 className="font-semibold text-lg text-text-main">Report a bug / Get help</h2>
        <p className="text-sm text-text-muted">
          Found a bug or have feedback? We’d love to hear from you. You can submit a ticket and follow up on the ZippyMesh website, or email us directly.
        </p>
        <div className="flex flex-col gap-3">
          <div>
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-primary hover:underline font-medium"
            >
              <span className="material-symbols-outlined text-lg">open_in_new</span>
              Open Support on ZippyMesh.com
            </a>
            <p className="mt-1 text-xs text-text-muted">
              Create or link your ZippyMesh.com profile to submit tickets and follow up here.
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={openReportBugMailto}
              className="inline-flex items-center gap-2 text-text-main hover:text-primary font-medium bg-transparent border-0 p-0 cursor-pointer text-left"
            >
              <span className="material-symbols-outlined text-lg">mail</span>
              Email us at {SUPPORT_EMAIL}
            </button>
            <p className="mt-1 text-xs text-text-muted">
              If you prefer not to add your info to ZippyMesh.com yet, you can email us instead. We’ll still get your message.
            </p>
          </div>
        </div>
      </Card>

      {activeTab === "overview" && (
        <div
          role="tabpanel"
          id="panel-overview"
          aria-labelledby="tab-overview"
          className="flex flex-col gap-4"
        >
          <Card className="flex flex-col gap-3 text-sm text-text-muted">
            <h2 className="font-semibold text-lg">Copy-ready summary</h2>
            <p className="text-sm text-text-muted">
              Paste this into notes, onboarding docs, or support replies:
            </p>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                icon={copied === "routing-summary" ? "check" : "content_copy"}
                onClick={() => copy(COPY_SUMMARY_TEXT, "routing-summary")}
              >
                {copied === "routing-summary" ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre className="bg-black/3 dark:bg-white/4 text-xs p-3 rounded-lg overflow-x-auto">
              {COPY_SUMMARY_TEXT}
            </pre>
          </Card>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {ROUTING_CONCEPTS.map((concept) => (
              <Card key={concept.title} className="flex flex-col gap-3 text-sm text-text-muted">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">{concept.icon}</span>
                  <h2 className="font-semibold text-lg">{concept.title}</h2>
                </div>
                <p className="text-sm text-text-main/90">{concept.description}</p>
                <p className="text-sm text-text-muted">{concept.details}</p>
                <div className="rounded-lg border border-black/5 dark:border-white/10 bg-surface/60 p-3 text-xs text-text-muted">
                  <p>
                    <span className="text-text-main font-medium">Example:</span> {concept.example}
                  </p>
                  <p className="mt-2">
                    <span className="text-text-main font-medium">Configure here:</span>{" "}
                    <Link className="text-primary hover:underline" href={concept.configureAt}>
                      {concept.configureAt}
                    </Link>
                  </p>
                </div>
              </Card>
            ))}
          </div>

            <Card className="flex flex-col gap-3 text-sm text-text-muted">
            <h2 className="font-semibold text-lg">Suggested setup order</h2>
            <p className="text-sm text-text-muted">
              Recommended for first-time use:
            </p>
            <ul className="list-disc pl-5 text-sm text-text-muted space-y-1">
              <li>Enable and test at least one provider in <Link href="/dashboard/providers" className="text-primary hover:underline">Providers</Link>.</li>
              <li>Set your global policy in <Link href="/dashboard/routing" className="text-primary hover:underline">Routing</Link> (AUTO is usually the best start).</li>
              <li>Create one high-confidence failover <Link href="/dashboard/combos" className="text-primary hover:underline">Combo</Link> for critical workloads.</li>
              <li>Refine behavior with <Link href="/dashboard/routing" className="text-primary hover:underline">Playbooks</Link> once your traffic patterns are stable.</li>
            </ul>
          </Card>
        </div>
      )}

      {activeTab === "behavior" && (
        <div
          role="tabpanel"
          id="panel-behavior"
          aria-labelledby="tab-behavior"
          className="flex flex-col gap-4"
        >
          <Card className="flex flex-col gap-4 text-sm text-text-muted">
            <h2 className="font-semibold text-lg">How a request is routed</h2>
            <ol className="pl-5 list-decimal space-y-2 text-sm text-text-muted">
              <li>Your request hits the API endpoint with a `model` value.</li>
              <li>Rate-limit and availability filters remove unhealthy providers from the candidate set.</li>
              <li>Routing mode chooses the policy:
                <ul className="pl-5 list-disc mt-1">
                  <li>Direct model name → normal routing with the current mode.</li>
                  <li>Combo name → ordered failover list is applied.</li>
                  <li>Playbook name (`zippymesh/*`, `free/*`, etc.) → playbook intent path is used.</li>
                </ul>
              </li>
              <li>For AUTO mode, playbook/pool/group/client/device triggers can select a matching playbook before base scoring.</li>
              <li>The top-ranked candidate is attempted first; on failure, failover continues across the chain.</li>
            </ol>
          </Card>

          <Card className="flex flex-col gap-2 text-sm text-text-muted">
            <h2 className="font-semibold text-lg">Where each main menu item fits</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-text-muted">
                  <tr>
                    <th className="pb-2 pr-4">Menu</th>
                    <th className="pb-2">What you do there</th>
                  </tr>
                </thead>
                <tbody className="text-text-main">
                  {ROUTING_PATHS.map((row) => (
                    <tr key={row.label} className="border-t border-black/5 dark:border-white/10">
                      <td className="py-2 pr-4">
                        <Link href={row.href} className="text-primary hover:underline">
                          {row.label}
                        </Link>
                      </td>
                      <td className="py-2 text-text-muted">{row.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {activeTab === "api" && (
        <div
          role="tabpanel"
          id="panel-api"
          aria-labelledby="tab-api"
          className="flex flex-col gap-4"
        >
          <Card className="flex flex-col gap-3 text-sm text-text-muted">
            <h2 className="font-semibold text-lg">API examples</h2>
            <p className="text-sm text-text-muted">
              Use these patterns in API calls:
            </p>
            <div className="space-y-3">
              {API_EXAMPLES.map((example) => (
                <div key={example.id} className="rounded-lg border border-black/10 dark:border-white/10 bg-black/2 dark:bg-white/2 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">{example.title}</p>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={copied === example.id ? "check" : "content_copy"}
                      onClick={() => copy(example.code, example.id)}
                    >
                      {copied === example.id ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <pre className="bg-black/3 dark:bg-white/4 text-xs p-3 rounded-lg overflow-x-auto">
                    {example.code}
                  </pre>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
