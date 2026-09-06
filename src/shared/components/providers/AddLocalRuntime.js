"use client";

/**
 * "Add a local runtime" — the fast path to the LLM the user already has running.
 *
 * The first thing someone does with ZMLR is point it at their own Ollama /
 * LM Studio / llama.cpp. Until 2026-08-30 the only way was "Scan Local Network"
 * (POST /api/discovery), a ~240 s sweep of every /24 of every non-internal IPv4
 * interface. This card probes exactly ONE url with a 5 s timeout via
 * `POST /api/provider-nodes {type:"local"}` and the node is a routing candidate
 * the moment it returns — no scan, no restart.
 *
 * The LAN sweep is still reachable, demoted to the secondary link below the
 * form (rendered only when the host page passes `onScanLan`).
 *
 * All non-React logic lives in ./addLocalRuntimeLogic.js and the fetch client in
 * ./addLocalRuntimeApi.js, so both are unit-testable in the repo's Node vitest
 * environment (there is no jsdom / testing-library here). Same convention as
 * AgentTokensPanel.js + agentTokenLogic.js + agentTokensApi.js.
 */

import { useCallback, useState } from "react";
import PropTypes from "prop-types";
import { useRouter } from "next/navigation";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import Select from "@/shared/components/Select";
import {
  DEFAULT_API_TYPE,
  RUNTIME_SELECT_OPTIONS,
  buildAddPayload,
  defaultBaseUrlFor,
  describeAddResult,
  runtimeOption,
} from "./addLocalRuntimeLogic.js";
import { addLocalRuntime } from "./addLocalRuntimeApi.js";

const TONE_STYLES = {
  success:
    "border-green-200 dark:border-green-900/50 bg-green-50/60 dark:bg-green-950/20 text-green-800 dark:text-green-200",
  info: "border-blue-200 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/20 text-blue-800 dark:text-blue-200",
  error:
    "border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-950/20 text-red-800 dark:text-red-200",
};

const TONE_ICONS = {
  success: "check_circle",
  info: "info",
  error: "error",
};

export default function AddLocalRuntime({
  onAdded,
  onScanLan,
  onUnauthorized,
  scanning = false,
  className,
  compact = false,
}) {
  const router = useRouter();

  const [apiType, setApiType] = useState(DEFAULT_API_TYPE);
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrlFor(DEFAULT_API_TYPE));
  // Until the field is edited by hand it tracks the picked runtime's default
  // port, so switching Ollama -> LM Studio moves 11434 -> 1234 on its own.
  const [baseUrlTouched, setBaseUrlTouched] = useState(false);
  const [name, setName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [result, setResult] = useState(null);

  const handleRuntimeChange = useCallback(
    (e) => {
      const next = e.target.value;
      setApiType(next);
      setFormError("");
      setResult(null);
      if (!baseUrlTouched) setBaseUrl(defaultBaseUrlFor(next));
    },
    [baseUrlTouched]
  );

  const handleBaseUrlChange = useCallback((e) => {
    setBaseUrl(e.target.value);
    setBaseUrlTouched(true);
    setFormError("");
  }, []);

  const handleReset = useCallback(() => {
    setBaseUrl(defaultBaseUrlFor(apiType));
    setBaseUrlTouched(false);
    setFormError("");
    setResult(null);
  }, [apiType]);

  async function handleAdd(e) {
    e.preventDefault();
    if (submitting) return;

    const built = buildAddPayload({ apiType, baseUrl, name });
    if (!built.ok) {
      setFormError(built.error);
      setResult(null);
      return;
    }

    setFormError("");
    setResult(null);
    setSubmitting(true);
    const r = await addLocalRuntime({ apiType, baseUrl, name });
    setSubmitting(false);

    const described = describeAddResult(r, apiType);
    setResult(described);

    if (described.kind === "unauthorized") {
      // A host that can't afford to be ejected — the setup wizard — passes
      // `onUnauthorized` and handles it inline. Fix for H2, 2026-08-30: the card
      // is rendered mid-wizard, where a `router.push("/login")` on a 401 threw
      // the user out of setup entirely. The dashboard keeps the redirect, which
      // is the right answer for an expired session on a page you can return to.
      if (typeof onUnauthorized === "function") {
        onUnauthorized(described);
        return;
      }
      router.push("/login");
      return;
    }
    if (r.ok && typeof onAdded === "function") onAdded(r.node, r);
  }

  const option = runtimeOption(apiType);
  const tone = result ? TONE_STYLES[result.tone] || TONE_STYLES.info : "";

  return (
    <Card padding={compact ? "sm" : "md"} className={className}>
      <form onSubmit={handleAdd} className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-primary shrink-0 mt-0.5">dns</span>
          <div className="min-w-0">
            <h3 className="font-semibold">Add a local runtime</h3>
            <p className="text-sm text-text-muted">
              Already running Ollama, LM Studio or llama.cpp? Point ZippyMesh straight at it —
              one probe, about a second. No LAN scan.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="sm:w-56">
            <Select
              label="Runtime"
              options={RUNTIME_SELECT_OPTIONS}
              value={apiType}
              onChange={handleRuntimeChange}
              placeholder=""
              disabled={submitting}
            />
          </div>
          <div className="flex-1 min-w-0">
            <Input
              label="Local base URL"
              value={baseUrl}
              onChange={handleBaseUrlChange}
              placeholder={defaultBaseUrlFor(apiType)}
              disabled={submitting}
              hint={
                option
                  ? `Default port ${option.defaultPort}. ZippyMesh probes ${option.probePath} itself — leave off any /v1.`
                  : undefined
              }
            />
          </div>
        </div>

        <Input
          label="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={option ? `${option.label} (127.0.0.1)` : "Local runtime"}
          disabled={submitting}
          hint="Leave blank and ZippyMesh names it after the runtime and host."
        />

        {formError && (
          <p className="text-sm text-red-500 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">error</span>
            {formError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" icon="add" loading={submitting} disabled={submitting}>
            {submitting ? "Connecting…" : "Add local runtime"}
          </Button>
          {(baseUrlTouched || result) && (
            <Button type="button" variant="ghost" size="md" onClick={handleReset} disabled={submitting}>
              Reset
            </Button>
          )}
        </div>

        {result && (
          <div className={`rounded-lg border p-3 text-sm ${tone}`}>
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">
                {TONE_ICONS[result.tone] || "info"}
              </span>
              <div className="min-w-0 flex flex-col gap-1">
                <p className="font-semibold">{result.title}</p>
                <p className="opacity-90">{result.detail}</p>
                {result.modelIds.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 mt-0.5">
                    {result.modelIds.map((id) => (
                      <li
                        key={id}
                        className="font-mono text-xs px-1.5 py-0.5 rounded border border-current/20 bg-black/5 dark:bg-white/5 break-all"
                      >
                        {id}
                      </li>
                    ))}
                    {result.extraCount > 0 && (
                      <li className="text-xs px-1.5 py-0.5 opacity-80">+{result.extraCount} more</li>
                    )}
                  </ul>
                )}
                {result.hint && <p className="opacity-90 mt-0.5">{result.hint}</p>}
              </div>
            </div>
          </div>
        )}

        {typeof onScanLan === "function" && (
          <p className="text-xs text-text-muted">
            Can&apos;t find it?{" "}
            <button
              type="button"
              onClick={onScanLan}
              disabled={scanning}
              className="underline underline-offset-2 hover:no-underline text-text-muted hover:text-text-main disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scanning ? "Scanning the LAN…" : "Scan the LAN instead"}
            </button>{" "}
            — sweeps every address on your subnet. Slow (minutes).
          </p>
        )}
      </form>
    </Card>
  );
}

AddLocalRuntime.propTypes = {
  /** Called with (node, result) after a 201 or a 200 dedupe. */
  onAdded: PropTypes.func,
  /** When given, renders the demoted "Scan the LAN instead" link. */
  onScanLan: PropTypes.func,
  /**
   * Called with the described 401 result INSTEAD of redirecting to /login.
   * Pass this from any host the user must not be ejected from mid-flow (the
   * setup wizard); omit it on the dashboard, where the redirect is correct.
   */
  onUnauthorized: PropTypes.func,
  /** True while the host page's LAN sweep is in flight. */
  scanning: PropTypes.bool,
  className: PropTypes.string,
  /** Tighter padding, for the setup wizard's narrow card. */
  compact: PropTypes.bool,
};
