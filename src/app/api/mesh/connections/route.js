import { NextResponse } from "next/server";
import {
  getNodeConnections,
  setNodeConnections,
  updateNodeConnection,
  getWallets,
} from "@/lib/localDb.js";
import { apiError, withStandardHeaders, getRequestIdFromRequest } from "@/lib/apiErrors.js";

export async function GET(request) {
  const requestId = getRequestIdFromRequest(request);
  try {
    const connections = await getNodeConnections();
    const wallets = await getWallets();
    return withStandardHeaders(NextResponse.json({
      connections,
      wallets,
    }), requestId);
  } catch (error) {
    console.error("Error fetching connections:", error);
    return apiError(request, 500, "Failed to fetch");
  }
}

export async function POST(request) {
  const requestId = getRequestIdFromRequest(request);
  try {
    const body = await request.json();
    const { peer_id, wallet_ids, contract_terms, action } = body;

    if (action === "update" && peer_id) {
      await updateNodeConnection(peer_id, {
        wallet_ids: wallet_ids || [],
        contract_terms: contract_terms || null,
      });
      const connections = await getNodeConnections();
      return withStandardHeaders(NextResponse.json({ connections }), requestId);
    }

    if (Array.isArray(body.connections)) {
      await setNodeConnections(body.connections);
      const connections = await getNodeConnections();
      return withStandardHeaders(NextResponse.json({ connections }), requestId);
    }

    return apiError(request, 400, "Invalid request");
  } catch (error) {
    console.error("Error updating connections:", error);
    return apiError(request, 500, "Failed to save");
  }
}
