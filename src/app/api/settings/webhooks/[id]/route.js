import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb.js";

/**
 * DELETE /api/settings/webhooks/[id]
 * Remove a webhook by ID.
 */
export async function DELETE(request, { params }) {
  try {
    const settings = await getSettings();
    const webhooks = (settings?.webhooks || []).filter(w => w.id !== params.id);
    await updateSettings({ ...settings, webhooks });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * PATCH /api/settings/webhooks/[id]
 * Update a webhook (toggle enabled, update URL, events, etc.)
 */
export async function PATCH(request, { params }) {
  try {
    const updates = await request.json();
    const settings = await getSettings();
    const webhooks = (settings?.webhooks || []).map(w =>
      w.id === params.id ? { ...w, ...updates, id: w.id } : w
    );
    await updateSettings({ ...settings, webhooks });
    const updated = webhooks.find(w => w.id === params.id);
    return NextResponse.json({ webhook: updated ?? null });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/settings/webhooks/[id]
 * Send a test payload to the webhook URL.
 */
export async function POST(request, { params }) {
  try {
    const settings = await getSettings();
    const webhook = (settings?.webhooks || []).find(w => w.id === params.id);
    if (!webhook) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });

    const testPayload = {
      event: "test",
      traceId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      model: "test-model",
      intent: "test",
      latencyMs: 0,
      success: true,
      message: "This is a test delivery from ZippyMesh",
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(webhook.headers || {}) },
        body: JSON.stringify(testPayload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return NextResponse.json({ ok: res.ok, statusCode: res.status });
    } catch (e) {
      clearTimeout(timeout);
      return NextResponse.json({ ok: false, error: e.message });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
