/**
 * TTL-cached index of the models the registered LOCAL runtimes actually serve.
 *
 * Why this exists (2026-08-30):
 *
 *  - `GET /v1/models` used to re-probe every local node on every call. With the
 *    catalogue sync and the api.kilo.ai fetch removed, that probe is what is
 *    left on the hot path; a short TTL makes a warm list effectively free.
 *  - The orchestrator has to resolve `model:"auto"` to something concrete for a
 *    provider that has no static model table. `PROVIDER_MODELS` has no "ollama"
 *    entry (open-sse/config/providerModels.js) and never should — a local
 *    runtime's inventory is whatever the user pulled — so the default comes from
 *    the runtime itself.
 *  - A client that round-trips `response.model` sends the bare provider-local
 *    tag (`qwen3.5:4b`). That has to resolve when exactly one registered
 *    provider serves it.
 *
 * Everything here fails soft: a runtime that is down yields an empty list, never
 * an exception on the request path.
 *
 * ## 2026-08-30, adversarial round — this file is now a trust boundary
 *
 * It used to flatten every `apiType:"ollama"` node into one `ollama/` namespace
 * and settle the resulting id collision with "either is a correct answer". That
 * was the delivery mechanism for a critical: a node registered through
 * `POST /api/provider-nodes` that claimed a tag the operator's real runtime
 * serves took delivery of the operator's prompts. Three things changed:
 *
 *   - `prefixForNode()` namespaces every node but the OWNER (loopback first,
 *     then earliest registration) as `ollama@<host>-<port>`;
 *   - `resolveBareModelId()` resolves a shadowed tag to the loopback node
 *     instead of refusing (which was also a bare-tag DoS);
 *   - `resolveLocalRouteTarget()` pins a local id to exactly one node so
 *     `RoutingEngine.findRoute` cannot offer another node's connection.
 *
 * Ordering here is therefore load-bearing, not cosmetic: see compareNodes().
 */

import { getProviderNodes } from "@/lib/localDb.js";
import { isLoopbackUrl } from "@/lib/routing/hostClass.js";
import { resolveProviderId } from "@/shared/constants/providers.js";

/** How long a probe result is reused. Local probes are ~5 ms; this is about not
 *  doing four of them inside one chat request. */
const DEFAULT_TTL_MS = 15_000;
const PROBE_TIMEOUT_LOCAL_MS = 3_000;
const PROBE_TIMEOUT_REMOTE_MS = 8_000;

/** Same caps as the registration probe: an unvetted runtime does not get to
 *  publish an unbounded list of unbounded ids into /v1/models (H1). */
const MAX_MODELS_PER_NODE = 500;
const MAX_MODEL_ID_CHARS = 128;

/** @type {{fetchedAt: number, entries: Array, byId: Map<string, object>, byTag: Map<string, object[]>}|null} */
let cache = null;
let inFlight = null;
/** Bumped by invalidate(); an in-flight probe started before the bump must not
 *  write its now-stale result back into `cache`. */
let generation = 0;

/** Drop the cache. Called after a node is registered/removed, and by tests. */
export function invalidateLocalModelIndex() {
  cache = null;
  inFlight = null;
  generation += 1;
}

/**
 * The BASE namespace for a node's apiType — `ollama` or `lmstudio`.
 *
 * This is the *shared* namespace. Exactly one node owns it (see
 * `prefixForNode`); every other node of the same apiType is namespaced per
 * node so it cannot shadow the owner's ids.
 */
export function baseNamespaceFor(node) {
  return node?.apiType === "ollama" ? "ollama" : "lmstudio";
}

/**
 * A stable, node-scoped slug: the normalized `host-port` of the node's base URL.
 * `http://192.0.2.10:11434` -> `192-0-2-10-11434` (192.0.2.0/24 is the
 * RFC 5737 documentation range; do not put a real internal address here).
 */
export function nodeSlug(node) {
  let host = "unknown";
  let port = "";
  try {
    const u = new URL(node?.baseUrl);
    host = u.hostname.replace(/^\[|\]$/g, "");
    port = u.port || (u.protocol === "https:" ? "443" : "80");
  } catch {
    return `node-${String(node?.id || "unknown").slice(0, 8)}`;
  }
  return `${host}-${port}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * The `/v1/models` id prefix (and provider id) for a local node.
 *
 * ## Why this is not just the apiType any more (fix for C1, 2026-08-30)
 *
 * It used to return the flat string `"ollama"` for EVERY node with
 * `apiType === "ollama"`, so all Ollama nodes shared one `ollama/` namespace and
 * `getLocalModelIndex` resolved the collision with "first node wins … either is
 * a correct answer". Registration is not a trust decision, so that let a node
 * registered by anyone who could reach `POST /api/provider-nodes` publish
 * `ollama/<a tag the real runtime serves>` and receive the operator's prompts.
 *
 * The scheme now:
 *
 *   - **one owner per apiType keeps the bare namespace** — `ollama/<tag>`. The
 *     owner is the first LOOPBACK node, else the earliest-registered node
 *     (`ownerNodeIdFor()`), so every id that worked before still works and the
 *     runtime on this machine can never be displaced by a later registration.
 *   - **every other node is namespaced per node** — `ollama@<host-port>/<tag>`,
 *     e.g. `ollama@10-0-11-2-11434/qwen3.5:4b`. Stable across restarts because
 *     it is derived from the base URL, not from a row id.
 *
 * @param {object} node
 * @param {string|null} [ownerNodeId] - the node that owns the bare namespace.
 *   Omitted (the single-node case, and every legacy caller) means "this node
 *   owns it", which is correct whenever there is only one node of its apiType.
 */
export function prefixForNode(node, ownerNodeId) {
  const base = baseNamespaceFor(node);
  if (ownerNodeId === undefined || ownerNodeId === null) return base;
  if (node?.id === ownerNodeId) return base;
  return `${base}@${nodeSlug(node)}`;
}

/**
 * Which node owns the bare namespace for its apiType.
 *
 * Deterministic and loopback-first: a runtime on this machine outranks anything
 * registered later, and among equals the earliest registration wins. This is the
 * "collision resolved deterministically" the review asked for, replacing
 * "either is a correct answer".
 *
 * @param {Array} nodes - local nodes, any order
 * @returns {Map<string, string>} apiType base namespace -> owning node id
 */
export function ownerNodeIdFor(nodes) {
  const owners = new Map();
  const ranked = [...nodes].sort(compareNodes);
  for (const n of ranked) {
    const base = baseNamespaceFor(n);
    if (!owners.has(base)) owners.set(base, n.id);
  }
  return owners;
}

/** loopback first, then earliest registration, then id — total and stable. */
function compareNodes(a, b) {
  const la = isLoopbackUrl(a?.baseUrl) ? 0 : 1;
  const lb = isLoopbackUrl(b?.baseUrl) ? 0 : 1;
  if (la !== lb) return la - lb;
  const ta = Date.parse(a?.createdAt || "") || Number.MAX_SAFE_INTEGER;
  const tb = Date.parse(b?.createdAt || "") || Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta - tb;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

/** Bounded, printable model ids only — see MAX_MODELS_PER_NODE. */
function capIds(raw) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const v of raw) {
    if (out.length >= MAX_MODELS_PER_NODE) break;
    if (typeof v !== "string") continue;
    const id = v.trim();
    if (!id || id.length > MAX_MODEL_ID_CHARS) continue;
    if (!/^[\x21-\x7e]+(?: [\x21-\x7e]+)*$/.test(id)) continue;
    out.push(id);
  }
  return out;
}

/**
 * Ask one local node what it serves. Never throws.
 * @returns {Promise<string[]>} provider-local model ids (Ollama tags, LM Studio ids)
 */
async function fetchNodeModels(node) {
  const timeout = isLoopbackUrl(node.baseUrl) ? PROBE_TIMEOUT_LOCAL_MS : PROBE_TIMEOUT_REMOTE_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    if (node.apiType === "ollama") {
      const res = await fetch(`${node.baseUrl}/api/tags`, { signal: controller.signal });
      if (!res.ok) return [];
      const data = await res.json();
      return capIds((data?.models || []).map((m) => m?.name));
    }
    const url = node.baseUrl?.endsWith("/v1") ? `${node.baseUrl}/models` : `${node.baseUrl}/v1/models`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const data = await res.json();
    return capIds((data?.data || []).map((m) => m?.id));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The index of everything the registered local runtimes serve.
 *
 * @param {{maxAgeMs?: number, force?: boolean}} [opts]
 * @returns {Promise<{fetchedAt:number, entries:Array<{id:string,tag:string,prefix:string,node:object}>, byId:Map, byTag:Map}>}
 */
export async function getLocalModelIndex(opts = {}) {
  const maxAge = opts.maxAgeMs ?? DEFAULT_TTL_MS;
  if (!opts.force && cache && Date.now() - cache.fetchedAt < maxAge) return cache;
  if (inFlight) return inFlight;

  const startedAt = generation;
  inFlight = (async () => {
    let nodes = [];
    try {
      nodes = (await getProviderNodes()) || [];
    } catch {
      nodes = [];
    }
    // Deterministic order — loopback first, then earliest registration. Both the
    // namespace owner and the bare-tag winner are read off this ordering, so
    // neither can be changed by registering another node (C1).
    nodes = nodes.filter((n) => n?.baseUrl && n.type === "local").sort(compareNodes);
    const owners = ownerNodeIdFor(nodes);

    const lists = await Promise.all(nodes.map((n) => fetchNodeModels(n)));

    const entries = [];
    const byId = new Map();
    const byTag = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const base = baseNamespaceFor(node);
      const prefix = prefixForNode(node, owners.get(base) ?? null);
      const loopback = isLoopbackUrl(node.baseUrl);
      for (const tag of lists[i]) {
        const id = `${prefix}/${tag}`;
        const entry = { id, tag, prefix, base, loopback, owner: prefix === base, node };
        // Ids are now node-scoped for every node but the namespace owner, so an
        // id collision can only mean the SAME node listed a tag twice. It is no
        // longer "two runtimes serve the same tag and either is a correct
        // answer" — that coin flip was C1's delivery mechanism.
        if (!byId.has(id)) {
          byId.set(id, entry);
          entries.push(entry);
        }
        const bucket = byTag.get(tag);
        if (bucket) {
          if (!bucket.some((e) => e.id === id)) bucket.push(entry);
        } else {
          byTag.set(tag, [entry]);
        }
      }
    }

    const result = { fetchedAt: Date.now(), entries, byId, byTag, owners };
    // Only publish if nothing invalidated us mid-probe (e.g. a node was
    // registered while this was in flight) — otherwise the caller still gets a
    // correct answer, it just is not cached.
    if (generation === startedAt) cache = result;
    return result;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Resolve a bare, provider-local model id to its provider-qualified form.
 *
 * This is what makes round-tripping `response.model` work: a client that reads
 * `"qwen3.5:4b"` off a completion and sends it back gets the same model instead
 * of a 404.
 *
 * ## Ambiguity (C1d, 2026-08-30)
 *
 * It used to answer only when EXACTLY ONE provider served the tag, and return
 * null otherwise. That had two bad consequences the review demonstrated:
 * registering any node that serves an existing tag made that tag ambiguous, so
 * a bare tag that worked yesterday silently stopped resolving (bare-tag DoS),
 * and before the namespacing fix the collision could hand the prompt to the
 * wrong runtime entirely.
 *
 * Now: when several nodes serve the tag, a **loopback** node wins outright; the
 * runtime on this machine is never displaced by a registration. Only when no
 * loopback node serves it AND two or more remote nodes do is the answer null —
 * genuinely ambiguous, with nothing to prefer.
 *
 * @param {string} modelStr
 * @returns {Promise<string|null>} `<prefix>/<tag>`, or null when it does not
 *   resolve (unknown tag, already qualified, or ambiguous among remote nodes).
 */
export async function resolveBareModelId(modelStr) {
  if (!modelStr || typeof modelStr !== "string") return null;
  const tag = modelStr.trim();
  if (!tag || tag === "auto" || tag.includes("/")) return null;

  let index;
  try {
    index = await getLocalModelIndex();
  } catch {
    return null;
  }
  const matches = index.byTag.get(tag);
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) return matches[0].id;

  // `matches` is in index order, which is loopback-first then earliest
  // registration, so the first loopback entry is the deterministic winner.
  const loopback = matches.filter((e) => e.loopback);
  if (loopback.length >= 1) return loopback[0].id;
  return null;
}

/**
 * Which NODE a local model id names — the routing half of the C1 fix.
 *
 * Namespacing the ids (see `prefixForNode`) stopped a second runtime from
 * *publishing* `ollama/<tag>`, but `syncLocalProviderConnection`
 * (src/lib/localDb.js) still gives every `apiType:"ollama"` node a connection
 * with `provider: "ollama"`, and the routing engine gathered EVERY such
 * connection as a candidate for any `ollama/*` model. So a second node could
 * still take delivery of a prompt addressed to the first — verified end to end
 * against the standalone build, where a shadow node answered
 * `POST /v1/chat/completions {"model":"qwen3.5:4b"}` with its own content even
 * after the id namespacing landed.
 *
 * This resolves an id to exactly one node so `RoutingEngine.findRoute` can pin
 * the candidate list to that node's connection.
 *
 * It reads the NODE LIST, never the probe index: a runtime that is momentarily
 * down must not make its ids fall back to "any ollama connection will do".
 *
 * @param {string} modelStr - e.g. "ollama/qwen3.5:4b", "ollama@10-0-11-2-11434/x"
 * @returns {Promise<{providerId: string, tag: string, nodeId: string|null, namespaced: boolean}|null>}
 *   null when this is not a local-runtime id at all.
 */
export async function resolveLocalRouteTarget(modelStr) {
  if (!modelStr || typeof modelStr !== "string") return null;
  const slash = modelStr.indexOf("/");
  if (slash <= 0) return null;

  const prefix = modelStr.slice(0, slash);
  const tag = modelStr.slice(slash + 1);
  if (!tag) return null;

  const at = prefix.indexOf("@");
  const rawBase = at > 0 ? prefix.slice(0, at) : prefix;
  const slug = at > 0 ? prefix.slice(at + 1) : null;
  // A provider ALIAS must pin too: `ol/qwen3.5:4b` is the same target as
  // `ollama/qwen3.5:4b`, and leaving the alias unpinned would have left the
  // whole C1 hole open behind a two-letter prefix.
  const base = (rawBase === "ollama" || rawBase === "lmstudio") ? rawBase : resolveProviderId(rawBase);
  if (base !== "ollama" && base !== "lmstudio") return null;

  let nodes = [];
  try {
    nodes = ((await getProviderNodes()) || []).filter((n) => n?.type === "local" && n?.baseUrl);
  } catch {
    return null;
  }
  const forBase = nodes.filter((n) => baseNamespaceFor(n) === base);
  if (forBase.length === 0) return { providerId: base, tag, nodeId: null, namespaced: !!slug };

  if (slug) {
    const match = forBase.find((n) => nodeSlug(n) === slug);
    return { providerId: base, tag, nodeId: match?.id ?? null, namespaced: true };
  }

  // The bare namespace belongs to exactly one node.
  const owners = ownerNodeIdFor(forBase);
  return { providerId: base, tag, nodeId: owners.get(base) ?? null, namespaced: false };
}

/**
 * A concrete model for a local provider that has no static model table.
 *
 * Used by the orchestrator when it has to turn `model:"auto"` (the playbook
 * path) into something a provider will accept and `getDefaultModel()` returned
 * null. Prefers a model served by the node the candidate connection points at.
 *
 * @param {string} providerId - "ollama" | "lmstudio"
 * @param {{baseUrl?: string, nodeId?: string}} [hint] - from connection.metadata
 * @returns {Promise<string|null>} a provider-local id, or null when nothing is served
 */
export async function pickLocalDefaultModel(providerId, hint = {}) {
  if (providerId !== "ollama" && providerId !== "lmstudio") return null;

  let index;
  try {
    index = await getLocalModelIndex();
  } catch {
    return null;
  }

  // An embedding-only model cannot answer a chat turn, so it is never the
  // default even when it is the first thing the runtime lists.
  const isEmbedding = (tag) => /embed/i.test(tag);
  // `base`, not `prefix`: a non-owner node is namespaced `ollama@<host-port>`
  // (see prefixForNode) but is still an Ollama runtime and is still a valid
  // fallback when the namespace owner serves nothing. Owner entries sort first,
  // and index order already puts loopback ahead of remote.
  const forProvider = index.entries
    .filter((e) => (e.base || e.prefix) === providerId)
    .sort((a, b) =>
      (Number(isEmbedding(a.tag)) - Number(isEmbedding(b.tag))) ||
      (Number(!a.owner) - Number(!b.owner))
    );
  if (forProvider.length === 0) return null;

  if (hint?.nodeId) {
    const onNode = forProvider.find((e) => e.node?.id === hint.nodeId);
    if (onNode) return onNode.tag;
  }
  if (hint?.baseUrl) {
    const onUrl = forProvider.find((e) => e.node?.baseUrl === hint.baseUrl);
    if (onUrl) return onUrl.tag;
  }
  return forProvider[0].tag;
}
