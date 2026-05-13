import { NextResponse } from "next/server";
import { purgeOldTraces, getSettings, updateSettings } from "@/lib/localDb.js";

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({
      retentionDays: settings?.traceRetentionDays ?? 30,
      piiScrubEnabled: settings?.guardrailsPiiEnabled ?? true,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { retentionDays, action } = await request.json();
    if (action === "purge") {
      const settings = await getSettings();
      const days = retentionDays ?? settings?.traceRetentionDays ?? 30;
      const deleted = purgeOldTraces(days);
      return NextResponse.json({ ok: true, deleted });
    }
    if (retentionDays !== undefined) {
      const settings = await getSettings();
      await updateSettings({ ...settings, traceRetentionDays: retentionDays });
      return NextResponse.json({ ok: true, retentionDays });
    }
    return NextResponse.json({ error: "action or retentionDays required" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
