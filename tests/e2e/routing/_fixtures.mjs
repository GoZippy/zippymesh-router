/**
 * Shared fixtures for the routing / OpenAI-compatibility e2e suite.
 *
 * These tests run against a PRODUCTION build started by
 * scripts/e2e/run-standalone.mjs on a throwaway DATA_DIR, and against a real
 * local Ollama. Nothing here starts a server or writes to disk.
 *
 *   node scripts/e2e/run-standalone.mjs tests/e2e/routing --port 20311
 *
 * Environment:
 *   ZMLR_E2E_BASE_URL / ZMLR_E2E_ADMIN_PASSWORD  set by the runner
 *   ZMLR_E2E_OLLAMA_URL   default http://127.0.0.1:11434
 *   ZMLR_E2E_CHAT_MODEL   default qwen3.5:4b   (bare Ollama tag, no prefix)
 *   ZMLR_E2E_EMBED_MODEL  default nomic-embed-text
 *   ZMLR_E2E_SKIP_DISCOVERY=1  do not fall back to the subnet scan; skip instead
 *
 * REGISTERING THE RUNTIME: `POST /api/provider-nodes {type:"local",
 * apiType:"ollama", baseUrl}` registers the local Ollama in one call (one probe,
 * 5 s timeout) — fixed 2026-08-30. The 240 s `POST /api/discovery` subnet sweep
 * is now only a fallback, kept so the suite still passes on a box where the
 * targeted route is unavailable. See
 * docs/_internal/OPENAI_COMPAT_CONTRACT_2026-08-30.md §10.
 */

import { api } from "../_lib/client.mjs";

export const OLLAMA_URL = process.env.ZMLR_E2E_OLLAMA_URL || "http://127.0.0.1:11434";
export const CHAT_TAG = process.env.ZMLR_E2E_CHAT_MODEL || "qwen3.5:4b";
export const EMBED_TAG = process.env.ZMLR_E2E_EMBED_MODEL || "nomic-embed-text";

/** The id form ZMLR exposes for a local Ollama model. THIS IS THE CONTRACT. */
export const CHAT_MODEL = `ollama/${CHAT_TAG}`;

/** A model id that must not resolve anywhere. */
export const MISSING_MODEL = "does-not-exist:0b";

/**
 * qwen3.5:4b is a thinking model: it spends its first few hundred tokens in
 * `message.reasoning` and only then writes `content`. A small max_tokens
 * reliably yields content:"" + finish_reason:"length". Every test that asserts
 * on assistant text uses this budget.
 */
export const CONTENT_BUDGET = 2000;

/**
 * Budget for the handful of assertions that require the model to actually
 * FINISH — `finish_reason: "stop"` and non-empty assistant text.
 *
 * CONTENT_BUDGET (2000) is enough for the response SHAPE, but not reliably
 * enough for a thinking model to think AND answer: on the 2026-08-30
 * reconciliation run `qwen3.5:4b` spent the whole 2000-token budget reasoning
 * about a one-word question and came back `content: "", finish_reason:
 * "length"` — a real property of the model, not a router defect, and exactly
 * what §4 of the contract doc describes. Only the three "the model completes
 * its turn" assertions pay for the larger budget; everything else stays on
 * CONTENT_BUDGET so the suite's latency profile is unchanged.
 */
export const FINISH_BUDGET = 6000;

/**
 * Budget for a `model:"auto"` / playbook request.
 *
 * `auto` picks whatever the recommender scores highest out of the models this
 * box actually has, and on this box that is currently `qwen3-vl:2b-thinking` —
 * which will happily spend 2000 tokens thinking and blow the suite's latency
 * budget. Which model `auto` picks is explicitly NOT part of the contract
 * (§9, "Do not rely on"), so a routing test must not depend on it being fast:
 * cap the budget instead. The assertions here are about the ENVELOPE and the
 * routing headers, never about the assistant's text, so a truncated answer
 * (`content: ""`, `finish_reason: "length"`) is a perfectly good result.
 */
export const AUTO_BUDGET = 48;

/** Unique marker so no two requests share a prompt-cache key. */
export function nonce() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Is the local Ollama reachable and does it have the model we need? */
export async function ollamaTags() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.models || []).map((m) => m.name);
  } catch {
    return null;
  }
}

/**
 * Local Ollama provider nodes currently registered in ZMLR.
 *
 * T2, fixed 2026-08-30: this used to be `if (res.status !== 200) return [];`, so
 * a 401, 403 or 500 from `/api/provider-nodes` set `ready = false` and silently
 * DISABLED suites 02-08 instead of failing them. That route 401ing is a live
 * regression class (H2), which makes "quietly skip everything" exactly the
 * wrong failure mode. A non-200 is now a thrown error: the setup test fails,
 * loudly, and says what it got.
 */
export async function ollamaNodes(cookie) {
  const res = await api("/api/provider-nodes", { cookie });
  if (res.status !== 200) {
    throw new Error(`GET /api/provider-nodes -> ${res.status} ${res.text.slice(0, 200)} (a route failure is not "no Ollama")`);
  }
  return (res.json?.nodes || []).filter((n) => n.type === "local" && n.apiType === "ollama" && n.baseUrl);
}

/**
 * The suite's readiness gate.
 *
 * T1, fixed 2026-08-30: every substantive test in 02, 03, 05, 06 and 08 sat
 * behind `if (!ready) return t.skip(...)`. `node:test` reports a skip as
 * non-failing and `scripts/e2e/run-standalone.mjs:314` propagates only the exit
 * code, so a fully-skipped file exited 0 — a total routing outage produced
 * roughly two red tests and ~55 green ones out of an advertised 88 checks.
 *
 * `ready` is now an ASSERTION by default. Set `ZMLR_E2E_ALLOW_SKIP=1` on a box
 * with no local LLM to get the old skip behaviour back, deliberately and
 * visibly.
 */
export const ALLOW_SKIP = process.env.ZMLR_E2E_ALLOW_SKIP === "1";

/**
 * @param {import("node:test").TestContext} t
 * @param {boolean} ready
 * @param {string} [what]
 * @returns {boolean} true when the test body should run
 */
export function requireReady(t, ready, what = "a registered local Ollama node") {
  if (ready) return true;
  if (ALLOW_SKIP) {
    t.skip(`ZMLR_E2E_ALLOW_SKIP=1 and there is no ${what} (see 01-provider-and-models)`);
    return false;
  }
  throw new Error(
    `no ${what}. The routing suite asserts this rather than skipping (T1): a silent skip turns a ` +
    `total routing outage into a green run. Start Ollama at ${OLLAMA_URL} with ${CHAT_TAG} pulled, ` +
    `or set ZMLR_E2E_ALLOW_SKIP=1 to opt out on purpose.`
  );
}

/**
 * Wait for the fire-and-forget prompt-cache write to land, then return the
 * result of a repeat request.
 *
 * T7, fixed 2026-08-30: the suite slept a flat 750 ms after the first request
 * and asserted on one retry. The write happens off a cloned response after the
 * first response is already on the wire, so 750 ms is a guess; this polls.
 *
 * @param {object} body
 * @param {{tries?: number, delayMs?: number, headers?: object}} [opts]
 */
export async function chatUntilCacheHit(body, { tries = 6, delayMs = 500, headers } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    last = await chat(body, { headers });
    if (last.headers.get("x-cache") === "HIT") return last;
  }
  return last;
}

/**
 * Register the local Ollama through the targeted fast path.
 * Returns the raw client result so a test can assert on status/body.
 */
export function registerOllamaNode(cookie, body = {}) {
  return api("/api/provider-nodes", {
    method: "POST",
    cookie,
    body: { type: "local", apiType: "ollama", baseUrl: OLLAMA_URL, ...body },
  });
}

/**
 * Make sure ZMLR has a local Ollama node.
 *
 * Fast path first (`POST /api/provider-nodes {type:"local"}`, one probe); the
 * 240 s subnet sweep is only a fallback for a build without that route.
 * Returns { nodes, method, scanned, ms, reason }; `nodes` is empty when the
 * runtime could not be registered — callers skip.
 */
export async function ensureOllamaRegistered(cookie) {
  const existing = await ollamaNodes(cookie);
  if (existing.length > 0) return { nodes: existing, method: "existing", scanned: false, ms: 0, reason: "already registered" };

  if ((await ollamaTags()) === null) {
    return { nodes: [], method: "none", scanned: false, ms: 0, reason: `no Ollama at ${OLLAMA_URL}` };
  }

  const t0 = Date.now();
  const fast = await registerOllamaNode(cookie);
  if (fast.status === 200 || fast.status === 201) {
    const ms = Date.now() - t0;
    const nodes = await ollamaNodes(cookie);
    return { nodes, method: "provider-nodes", scanned: false, ms, reason: `POST /api/provider-nodes -> ${fast.status}` };
  }

  if (process.env.ZMLR_E2E_SKIP_DISCOVERY === "1") {
    return { nodes: [], method: "none", scanned: false, ms: Date.now() - t0, reason: `fast path ${fast.status}, ZMLR_E2E_SKIP_DISCOVERY=1` };
  }

  const t1 = Date.now();
  const scan = await api("/api/discovery", { method: "POST", cookie });
  const ms = Date.now() - t1;
  if (scan.status !== 200) {
    return { nodes: [], method: "discovery", scanned: true, ms, reason: `POST /api/discovery -> ${scan.status}` };
  }
  const nodes = await ollamaNodes(cookie);
  return { nodes, method: "discovery", scanned: true, ms, reason: nodes.length ? "discovered" : "scan found no Ollama" };
}

/** POST /v1/chat/completions with a JSON body; returns the client result. */
export function chat(body, { headers, cookie } = {}) {
  return api("/v1/chat/completions", { method: "POST", body, headers, cookie });
}

/**
 * POST /v1/chat/completions with stream:true and drain the SSE response.
 * Returns the raw text plus everything a client SDK would derive from it.
 */
export async function chatStream(body, { headers = {} } = {}) {
  const base = (process.env.ZMLR_E2E_BASE_URL || "").replace(/\/+$/, "");
  const t0 = Date.now();
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ ...body, stream: true }),
  });

  let raw = "";
  let ttfbMs = null;
  let ttfcMs = null;
  if (res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const s = dec.decode(value, { stream: true });
      raw += s;
      if (ttfbMs === null) ttfbMs = Date.now() - t0;
      if (ttfcMs === null && /"content":"[^"]/.test(s)) ttfcMs = Date.now() - t0;
    }
  }

  const dataLines = raw.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6).trim());
  const sawDone = dataLines.includes("[DONE]");
  const chunks = [];
  const unparsable = [];
  for (const p of dataLines) {
    if (p === "[DONE]") continue;
    try { chunks.push(JSON.parse(p)); } catch { unparsable.push(p.slice(0, 120)); }
  }
  const content = chunks.map((c) => c?.choices?.[0]?.delta?.content || "").join("");
  const finishReasons = chunks.map((c) => c?.choices?.[0]?.finish_reason).filter(Boolean);

  return {
    status: res.status,
    headers: res.headers,
    contentType: res.headers.get("content-type") || "",
    raw, dataLines, chunks, unparsable, sawDone, content, finishReasons,
    ttfbMs, ttfcMs, totalMs: Date.now() - t0,
  };
}

/** Assert-friendly OpenAI error-envelope check. Returns the error object. */
export function errorEnvelope(json) {
  if (!json || typeof json !== "object" || !json.error || typeof json.error !== "object") {
    throw new Error(`not an OpenAI error envelope: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json.error;
}
