import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb.js";
import { testWebhook, getDeliveryHistory } from "@/lib/logExporter.js";
import { randomUUID } from "crypto";

/**
 * GET /api/settings/webhooks
 * Returns { webhooks: [], deliveryHistory: [] }
 */
export async function GET() {
  try {
    const settings = await getSettings();
    const webhooks = (settings?.webhooks || []).map(w => ({
      ...w,
      headers: undefined, // never expose secret header values in list response
    }));
    return NextResponse.json({ webhooks, deliveryHistory: getDeliveryHistory() });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/settings/webhooks
 * Create a new webhook entry.
 * Body: { url, events, headers, enabled }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { url, events, headers = {}, enabled = true } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: "events array is required" }, { status: 400 });
    }

    const settings = await getSettings();
    const webhooks = settings?.webhooks ?? [];
    const newWebhook = { id: randomUUID(), url, events, headers, enabled };
    webhooks.push(newWebhook);
    await updateSettings({ ...settings, webhooks });

    return NextResponse.json({ webhook: { ...newWebhook, headers: undefined } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * DELETE /api/settings/webhooks?id=<uuid>
 * Remove a webhook by ID.
 */
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const settings = await getSettings();
    const webhooks = (settings?.webhooks ?? []).filter(w => w.id !== id);
    await updateSettings({ ...settings, webhooks });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * PATCH /api/settings/webhooks?id=<uuid>
 * Update a webhook (url, events, headers, enabled).
 * Also handles { action: "test" } to fire a test payload.
 */
export async function PATCH(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const body = await request.json();

    // Test action
    if (body.action === "test") {
      const settings = await getSettings();
      const webhook = (settings?.webhooks ?? []).find(w => w.id === id);
      if (!webhook) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
      const result = await testWebhook(webhook.url, webhook.headers ?? {});
      return NextResponse.json(result);
    }

    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const settings = await getSettings();
    const webhooks = settings?.webhooks ?? [];
    const idx = webhooks.findIndex(w => w.id === id);
    if (idx === -1) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });

    webhooks[idx] = { ...webhooks[idx], ...body };
    await updateSettings({ ...settings, webhooks });

    return NextResponse.json({ webhook: { ...webhooks[idx], headers: undefined } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
