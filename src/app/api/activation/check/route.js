import { NextResponse } from "next/server";

// Simple in-memory cache for activation checks (shared across requests)
// Note: This cache is per-instance. For distributed systems, use Redis or similar.
const activationCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute for transient errors

function getCachedActivation(wallet) {
  const cached = activationCache.get(wallet);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  if (cached) activationCache.delete(wallet);
  return null;
}

function setCachedActivation(wallet, data) {
  // Limit cache size to prevent memory issues
  if (activationCache.size >= 1000) {
    const firstKey = activationCache.keys().next().value;
    if (firstKey) activationCache.delete(firstKey);
  }
  activationCache.set(wallet, { data, timestamp: Date.now() });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  }

  // Check cache first to handle transient API failures gracefully
  const cached = getCachedActivation(wallet);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  const apiUrl = process.env.ACTIVATION_API_URL;
  const apiKey = process.env.ACTIVATION_API_KEY;
  if (!apiUrl || !apiKey) {
    return NextResponse.json({ activated: true }); // Offline mode: allow
  }

  try {
    // Use URL API for safe URL construction
    const checkUrl = new URL('/api/activation/status', apiUrl);
    checkUrl.searchParams.set('wallet', wallet);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const res = await fetch(checkUrl.toString(), {
      headers: { "x-activation-api-key": apiKey },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      // API error - fail closed but cache briefly to prevent hammering
      const fallback = { activated: false, reason: `api_error_${res.status}` };
      setCachedActivation(wallet, fallback);
      return NextResponse.json(fallback);
    }

    const data = await res.json();
    // Cache successful responses
    setCachedActivation(wallet, data);
    return NextResponse.json(data);
  } catch (err) {
    // Network/timeout error - fail closed but cache briefly
    // This prevents lockouts during transient network issues
    const fallback = { activated: false, reason: "transient_error", retry_after: 30 };
    setCachedActivation(wallet, fallback);
    return NextResponse.json(fallback);
  }
}
