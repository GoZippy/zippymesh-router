/**
 * Client for the one-call local-runtime registration path.
 *
 *   POST /api/provider-nodes { type:"local", apiType, baseUrl?, name? }
 *
 * Wraps safeFetchJson so every caller gets the same normalised shape:
 *   { ok: true,  status, created, node, models, modelIds }
 *   { ok: false, status, unauthorized, error }
 *
 * `unauthorized` is set on 401 so the card can use the dashboard's existing
 * "session expired -> /login" pattern (see AgentTokensPanel.js / profile page).
 *
 * Imported deep from `@/shared/utils/http` rather than the `@/shared/utils`
 * barrel: http.js has no imports of its own, which keeps this module loadable
 * in the Node vitest environment without dragging in the rest of the barrel.
 */

import { safeFetchJson } from "@/shared/utils/http";
import { buildAddPayload, extractErrorMessage } from "./addLocalRuntimeLogic.js";

const PROVIDER_NODES_URL = "/api/provider-nodes";
const JSON_HEADERS = { "Content-Type": "application/json" };

function fail(result, fallback) {
  return {
    ok: false,
    status: result?.status ?? 0,
    unauthorized: result?.status === 401,
    error: extractErrorMessage(result, fallback),
  };
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((m) => typeof m === "string" && m) : [];
}

/**
 * Register (or find) one locally-hosted runtime.
 *
 * The route answers 201 when it created a node, 200 when the same host:port was
 * already registered, 400 for a bad apiType/baseUrl and 502 when nothing
 * answered the probe. `created` distinguishes 201 from 200 — this reads
 * `data.created` rather than the status code so a proxy that rewrites 201 to
 * 200 cannot turn "added" into "already connected".
 *
 * @param {{apiType?: string, baseUrl?: string, name?: string}} form
 */
export async function addLocalRuntime(form = {}) {
  const built = buildAddPayload(form);
  if (!built.ok) {
    // Client-side rejection: never spend a round trip on a URL we already know
    // the server will 400 on.
    return { ok: false, status: 0, unauthorized: false, error: built.error };
  }

  const r = await safeFetchJson(PROVIDER_NODES_URL, {
    method: "POST",
    credentials: "include",
    headers: JSON_HEADERS,
    body: JSON.stringify(built.payload),
  });

  if (!r.ok) return fail(r, "Could not add the local runtime");

  const d = r.data || {};
  return {
    ok: true,
    status: r.status,
    created: d.created === true,
    node: d.node ?? null,
    models: stringList(d.models),
    modelIds: stringList(d.modelIds),
  };
}
