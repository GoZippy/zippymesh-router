import { NextResponse } from "next/server";
import {
  getNodeConnections,
  setNodeConnections,
  updateNodeConnection,
  getWallets,
} from "@/lib/localDb.js";

export async function GET() {
  try {
    const connections = await getNodeConnections();
    const wallets = await getWallets();
    return NextResponse.json({
      connections,
      wallets,
    });
  } catch (error) {
    console.error("Error fetching connections:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { peer_id, wallet_ids, contract_terms, action } = body;

    if (action === "update" && peer_id) {
      await updateNodeConnection(peer_id, {
        wallet_ids: wallet_ids || [],
        contract_terms: contract_terms || null,
      });
      const connections = await getNodeConnections();
      return NextResponse.json({ connections });
    }

    if (Array.isArray(body.connections)) {
      await setNodeConnections(body.connections);
      const connections = await getNodeConnections();
      return NextResponse.json({ connections });
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (error) {
    console.error("Error updating connections:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
