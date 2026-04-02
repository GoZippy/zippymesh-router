/**
 * logExporter.js — Fire-and-forget webhook dispatcher for ZMLR events.
 *
 * Usage:
 *   dispatchWebhookEvent("request_complete", payload).catch(() => {});
 *
 * Never awaits from the hot path. All failures are silently swallowed
 * so webhook issues never affect routing responses.
 */

import { getSettings } from "@/lib/localDb.js";

// In-memory ring buffer for delivery history (last 50 entries)
const MAX_HISTORY = 50;
const deliveryHistory = [];

function addToHistory(entry) {
  deliveryHistory.unshift(entry);
  if (deliveryHistory.length > MAX_HISTORY) deliveryHistory.pop();
}

/**
 * Get delivery history (most recent first).
 * @returns {Array}
 */
export function getDeliveryHistory() {
  return [...deliveryHistory];
}

/**
 * POST a payload to a single webhook URL with exponential backoff retries.
 * @param {string} url
 * @param {object} payload
 * @param {object} extraHeaders - Custom headers from the webhook config
 * @param {number} maxRetries
 */
async function postToWebhook(url, payload, extraHeaders = {}, maxRetries = 3) {
  const delays = [1000, 5000, 15000];
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, delays[attempt - 1] ?? 15000));
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ZippyMesh-LLM-Router/1.0",
          ...extraHeaders,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return { ok: true, status: res.status, attempts: attempt + 1 };
    } catch (err) {
      lastError = err;
    }
  }
  return { ok: false, error: lastError?.message ?? "Unknown error", attempts: maxRetries };
}

/**
 * Dispatch an event to all configured webhooks that subscribe to it.
 * Fire-and-forget — returns a Promise but callers should .catch(() => {}).
 *
 * @param {string} event - Event name: "request_complete" | "routing_error" | "cache_hit"
 * @param {object} payload - Event-specific data
 */
export async function dispatchWebhookEvent(event, payload) {
  let settings;
  try {
    settings = await getSettings();
  } catch {
    return; // can't load settings — skip
  }

  const webhooks = settings?.webhooks;
  if (!Array.isArray(webhooks) || webhooks.length === 0) return;

  const active = webhooks.filter(w => w.enabled !== false && Array.isArray(w.events) && w.events.includes(event) && w.url);
  if (active.length === 0) return;

  const enrichedPayload = {
    ...payload,
    event,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    source: "zmlr",
  };

  const dispatches = active.map(async (webhook) => {
    const startedAt = Date.now();
    const result = await postToWebhook(webhook.url, enrichedPayload, webhook.headers ?? {});
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      event,
      url: webhook.url,
      webhookId: webhook.id,
      status: result.ok ? result.status : "error",
      ok: result.ok,
      error: result.error ?? null,
      latencyMs: Date.now() - startedAt,
      attempts: result.attempts,
    };
    addToHistory(entry);
  });

  await Promise.allSettled(dispatches);
}

/**
 * Send a test payload to a specific webhook URL.
 * @param {string} url
 * @param {object} extraHeaders
 * @returns {{ ok: boolean, status?: number, error?: string }}
 */
export async function testWebhook(url, extraHeaders = {}) {
  return postToWebhook(
    url,
    {
      event: "test",
      timestamp: new Date().toISOString(),
      message: "This is a test from ZippyMesh LLM Router.",
      source: "zmlr",
    },
    extraHeaders,
    1 // single attempt for test
  );
}
