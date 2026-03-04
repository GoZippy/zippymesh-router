/**
 * Shared utilities for sidecar communication
 * (No localDb import here to avoid pulling Node-only code into client bundle.)
 */

const DEFAULT_SIDECAR_URL = "http://localhost:9480";

/**
 * Get the normalized sidecar base URL from environment or default
 * @returns {string} Normalized sidecar URL without trailing slash
 */
export function getSidecarUrl() {
  const url = process.env.SIDE_CAR_URL || DEFAULT_SIDECAR_URL;
  return url.replace(/\/$/, "");
}

/**
 * Build a sidecar API URL for a given path
 * @param {string} path - API path (e.g., "/trust", "/node/pricing")
 * @returns {string} Full URL
 */
export function sidecarUrl(path) {
  const base = getSidecarUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

/**
 * Fetch from sidecar with standard options
 * @param {string} path - API path
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function fetchSidecar(path, options = {}) {
  const url = sidecarUrl(path);
  const headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };
  return fetch(url, {
    ...options,
    headers
  });
}

/**
 * Fetch from sidecar with timeout
 * @param {string} path - API path
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {RequestInit} options - Additional fetch options
 * @returns {Promise<Response>}
 */
export async function fetchSidecarWithTimeout(path, timeoutMs = 5000, options = {}) {
  const url = sidecarUrl(path);

  return fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Proxy a chat completion request to the sidecar (P2P).
 * POSTs the payload to sidecar /proxy/chat/completions and returns the Response.
 * @param {object} p2pPayload - Request body (model, messages, etc.)
 * @returns {Promise<Response>} Fetch Response from sidecar
 */
export async function proxyChatCompletion(p2pPayload) {
  const url = sidecarUrl("/proxy/chat/completions");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(p2pPayload),
  });
  return res;
}

/** Return P2P peers from sidecar /peers; [] on failure. */
export async function getSidecarPeers() {
  try {
    const res = await fetchSidecarWithTimeout("/peers", 3000);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : data?.peers ?? [];
  } catch {
    return [];
  }
}

/** Sidecar health check; returns { ok: boolean }. */
export async function getSidecarHealth() {
  try {
    const res = await fetchSidecarWithTimeout("/health", 3000);
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

/** Sidecar info stub; returns {} when sidecar unavailable. */
export async function getSidecarInfo() {
  try {
    const res = await fetchSidecarWithTimeout("/info", 2000);
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

/** Stub for UI; use localDb in server routes for real data. */
export async function getWalletBalance() {
  return { balance: 0, currency: "ZIP" };
}

/** Stub for UI; use localDb in server routes for real data. */
export async function getWalletTransactions() {
  return [];
}

/** Wallet earnings stub; returns 0. */
export async function getWalletEarnings() {
  return 0;
}

/** Open payment channel via sidecar; stub throws until sidecar implements. */
export async function openPaymentChannel(to, amount) {
  const url = sidecarUrl("/wallet/send");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, amount }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Sidecar wallet/send failed: ${res.status}`);
  }
  return res.json();
}
