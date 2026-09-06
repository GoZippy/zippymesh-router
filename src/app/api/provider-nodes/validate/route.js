/**
 * Route-level auth added 2026-08-30 (same class as C1a): this handler takes a
 * caller-supplied `baseUrl` and an API key and performs an outbound `fetch()`
 * with that key attached. Unguarded, it is both a credential-relay and a
 * reachability oracle. It reflects only `res.ok`, so it is a one-bit oracle
 * rather than H1's three-state one, but it had no guard of its own either.
 */

import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { requireAuth } from "@/lib/auth/middleware.js";

// POST /api/provider-nodes/validate - Validate API key against base URL
export const POST = requireAuth(async function POST(request) {
  try {
    const body = await request.json();
    const { baseUrl, apiKey, type } = body;

    if (!baseUrl || !apiKey) {
      return apiError(request, 400, "Base URL and API key required");
    }

    // Anthropic Compatible Validation
    if (type === "anthropic-compatible") {
      // Robustly construct URL: remove trailing slash, and remove trailing /messages if user added it
      let normalizedBase = baseUrl.trim().replace(/\/$/, "");
      if (normalizedBase.endsWith("/messages")) {
        normalizedBase = normalizedBase.slice(0, -9); // remove /messages
      }
      
      // Use /models endpoint for validation as many compatible providers support it (like OpenAI)
      const modelsUrl = `${normalizedBase}/models`;
      
      const res = await fetch(modelsUrl, {
        method: "GET",
        redirect: "manual", // never relay the API key to a redirect target (V-1)
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Authorization": `Bearer ${apiKey}` // Add Bearer token for hybrid proxies
        }
      });

      return NextResponse.json({ valid: res.ok, error: res.ok ? null : "Invalid API key" });
    }

    // OpenAI Compatible Validation (Default)
    const modelsUrl = `${baseUrl.replace(/\/$/, "")}/models`;
    const res = await fetch(modelsUrl, {
      redirect: "manual", // never relay the API key to a redirect target (V-1)
      headers: { "Authorization": `Bearer ${apiKey}` },
    });

    return NextResponse.json({ valid: res.ok, error: res.ok ? null : "Invalid API key" });
  } catch (error) {
    console.log("Error validating provider node:", error);
    return apiError(request, 500, "Validation failed");
  }
});
