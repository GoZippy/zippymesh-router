import { NextResponse } from "next/server";
import { listMarketplacePlaybooks, publishMarketplacePlaybook } from "@/lib/localDb.js";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = listMarketplacePlaybooks({
      intent: searchParams.get("intent"),
      tag: searchParams.get("tag"),
      search: searchParams.get("search"),
      sort: searchParams.get("sort") || "downloads",
      limit: parseInt(searchParams.get("limit") || "20"),
      offset: parseInt(searchParams.get("offset") || "0"),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { title, description, author, intent, tags, rules } = body;
    if (!title || !rules?.length) return NextResponse.json({ error: "title and rules are required" }, { status: 400 });
    const id = publishMarketplacePlaybook({ title, description, author, intent, tags, rulesJson: JSON.stringify(rules) });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
