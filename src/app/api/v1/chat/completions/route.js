import { callCloudWithMachineId } from "@/shared/utils/cloud.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

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

