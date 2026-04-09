import { NextResponse } from "next/server";
import { getMarketplacePlaybook, incrementMarketplaceDownloads, rateMarketplacePlaybook } from "@/lib/localDb.js";

export async function GET(request, { params }) {
  try {
    const p = getMarketplacePlaybook(params.id);
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(p);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { action, rating } = await request.json();
    if (action === "download") {
      const p = getMarketplacePlaybook(params.id);
      if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
      incrementMarketplaceDownloads(params.id);
      return NextResponse.json({ rules: JSON.parse(p.rules_json), title: p.title });
    }
    if (action === "rate" && rating) {
      rateMarketplacePlaybook(params.id, rating);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
