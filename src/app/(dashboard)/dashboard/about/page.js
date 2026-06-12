"use client";

import Link from "next/link";
import { Button, Card } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const quickLinks = [
  { label: "Routing", href: "/dashboard/routing" },
  { label: "Pools", href: "/dashboard/pools" },
  { label: "Combos", href: "/dashboard/combos" },
  { label: "Providers", href: "/dashboard/providers" },
  { label: "Full help docs", href: "/dashboard/help" },
];

const ABOUT_FLOW_TEXT = `Request -> Policy -> Candidates -> Scoring -> Model call -> Failover`;
const TROUBLESHOOTING_LINKS = [
  { href: "/dashboard/providers", label: "Provider not healthy?", why: "Check provider status and key usage in Providers.", icon: "error" },
  { href: "/dashboard/pools", label: "Pool order looks wrong", why: "Check group and priority rules in Pools.", icon: "refresh" },
  { href: "/dashboard/routing", label: "Unexpected model choice", why: "Review routing mode and active playbooks in Routing.", icon: "layers" },
  { href: "/dashboard/combos", label: "Combo not failing over", why: "Inspect combo ordering and model health in Combos.", icon: "bar_chart" },
];

export default function AboutPage() {
  const { copied, copy } = useCopyToClipboard();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">About ZippyMesh</h1>
        <p className="text-sm text-text-muted mt-1">
          ZippyMesh is an OpenAI-compatible router that picks a model, tracks health, and applies failover so your app keeps working when providers are unavailable.
        </p>
      </div>

      <Card className="flex flex-col gap-2 text-sm">
        <p>
          <span className="font-semibold text-text-main">Suggested flow:</span>{" "}
          <span className="text-text-muted">{ABOUT_FLOW_TEXT}</span>
        </p>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            icon={copied === "about-flow" ? "check" : "content_copy"}
            onClick={() => copy(ABOUT_FLOW_TEXT, "about-flow")}
          >
            {copied === "about-flow" ? "Copied" : "Copy"}
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-2 text-text-muted">
        <h2 className="font-semibold text-text-main text-base mb-2">Need help?</h2>
        <p className="text-sm text-text-muted mb-2">
          If routing behavior feels off, check these first:
        </p>
        <div className="space-y-2 text-sm text-text-muted">
          {TROUBLESHOOTING_LINKS.map((item) => (
            <p key={item.label} className="flex items-start gap-2">
              <span className="material-symbols-outlined text-text-muted leading-none mt-0.5">{item.icon}</span>
              <span>
                <Link href={item.href} className="text-primary hover:underline font-medium">
                  {item.label}
                </Link>
                <span className="ml-1 text-text-muted">— {item.why}</span>
              </span>
            </p>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-2 text-sm text-text-muted">
        <h2 className="font-semibold text-text-main text-base mb-2">At a glance</h2>
        <p className="mb-2">The router uses three layers:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Policy: routing mode and playbooks define how candidates are chosen.</li>
          <li>Inventory: provider pool and model availability determine what can be used.</li>
          <li>Fallback: failover and combos ensure continuity when a model call fails.</li>
        </ul>
      </Card>

      <Card className="flex flex-col gap-2 text-sm text-text-muted">
        <h2 className="font-semibold text-text-main text-base mb-2">Get started quickly</h2>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Add at least one provider connection.</li>
          <li>Set your routing mode in <Link href="/dashboard/routing" className="text-primary hover:underline">Routing</Link>.</li>
          <li>Create a combo for critical paths in <Link href="/dashboard/combos" className="text-primary hover:underline">Combos</Link>.</li>
          <li>Refine behavior with playbooks once traffic patterns are stable.</li>
        </ol>
      </Card>

      <Card className="flex flex-col gap-2 text-sm">
        <h2 className="font-semibold text-text-main text-base mb-2">Explore</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          {quickLinks.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="inline-flex items-center px-3 py-1.5 rounded-full border border-black/10 dark:border-white/10 text-text-muted hover:border-primary hover:text-primary transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
