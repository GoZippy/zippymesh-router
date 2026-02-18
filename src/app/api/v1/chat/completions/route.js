import { callCloudWithMachineId } from "@/shared/utils/cloud.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { proxyChatCompletion } from "@/lib/sidecar";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
    console.log("[SSE] Translators initialized");
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function POST(request) {
  // Check for P2P model
  const clone = request.clone();
  try {
    const body = await clone.json();
    if (body.model && body.model.startsWith("p2p/")) {
      console.log(`[Proxy] Forwarding P2P request for ${body.model}`);
      // Strip prefix
      const p2pPayload = { ...body, model: body.model.replace("p2p/", "") };

      const proxyRes = await proxyChatCompletion(p2pPayload);

      // Return proxy response directly
      return new Response(proxyRes.body, {
        status: proxyRes.status,
        headers: proxyRes.headers
      });
    }
  } catch (e) {
    console.error("[Proxy] Error checking P2P model:", e);
  }

  // Fallback to local handling
  await ensureInitialized();

  const res = await handleChat(request);

  // Ensure we return a Response object for Next.js
  if (res && typeof res === 'object' && !(res instanceof Response)) {
    const { NextResponse } = await import("next/server");
    return NextResponse.json(res, { status: res.status || 500 });
  }

  return res;
}

