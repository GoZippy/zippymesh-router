/**
 * Route-level auth added 2026-08-30 (C1a). PUT rewrites a node's `baseUrl` —
 * i.e. it can repoint an existing routing target at another host without going
 * through the registration probe at all — and DELETE removes one. Both are
 * "sensitive management routes" in the sense src/middleware.js:120-129 means,
 * and neither had a guard of its own.
 */

import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { deleteProviderConnectionsByProvider, deleteProviderNode, getProviderConnections, getProviderNodeById, updateProviderConnection, updateProviderNode } from "@/models";
import { requireAuth } from "@/lib/auth/middleware.js";
import { invalidateLocalModelIndex } from "@/lib/routing/localModelIndex.js";
import { checkRegistrationTarget } from "@/lib/routing/hostClass.js";

// PUT /api/provider-nodes/[id] - Update provider node
export const PUT = requireAuth(async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, prefix, apiType, baseUrl } = body;
    const node = await getProviderNodeById(id);

    if (!node) {
      return apiError(request, 404, "Provider node not found");
    }

    if (!name?.trim()) {
      return apiError(request, 400, "Name is required");
    }

    if (!prefix?.trim()) {
      return apiError(request, 400, "Prefix is required");
    }

    // Only validate apiType for OpenAI Compatible nodes
    if (node.type === "openai-compatible" && (!apiType || !["chat", "responses"].includes(apiType))) {
      return apiError(request, 400, "Invalid OpenAI compatible API type");
    }

    if (!baseUrl?.trim()) {
      return apiError(request, 400, "Base URL is required");
    }

    let sanitizedBaseUrl = baseUrl.trim();

    // A `type:"local"` node is a routing target. Repointing one at an arbitrary
    // host through PUT would sidestep the registration gate entirely, so the
    // same host allow-list applies here (C1b / H1).
    if (node.type === "local") {
      const gate = await checkRegistrationTarget(sanitizedBaseUrl, {
        allowRemote: body?.allowRemote === true,
        // PUT does not offer the admin escalation: change the node's URL to
        // something loopback/private, or delete it and register the new target.
        isAdmin: false,
      });
      if (!gate.allowed) {
        return apiError(request, 403, gate.reason || "Refusing to repoint a local runtime at that host");
      }
    }

    // Sanitize Base URL for Anthropic Compatible
    if (node.type === "anthropic-compatible") {
      sanitizedBaseUrl = sanitizedBaseUrl.replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/messages")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -9); // remove /messages
      }
    }

    const updates = {
      name: name.trim(),
      prefix: prefix.trim(),
      baseUrl: sanitizedBaseUrl,
    };

    if (node.type === "openai-compatible") {
      updates.apiType = apiType;
    }

    const updated = await updateProviderNode(id, updates);

    const connections = await getProviderConnections({ provider: id });
    await Promise.all(connections.map((connection) => (
      updateProviderConnection(connection.id, {
        providerSpecificData: {
          ...(connection.providerSpecificData || {}),
          prefix: prefix.trim(),
          apiType: node.type === "openai-compatible" ? apiType : undefined,
          baseUrl: sanitizedBaseUrl,
          nodeName: updated.name,
        }
      })
    )));

    // The bare `ollama/` namespace owner and the bare-tag resolution both read a
    // TTL-cached view of the local nodes; a changed baseUrl can change both.
    invalidateLocalModelIndex();

    return NextResponse.json({ node: updated });
  } catch (error) {
    console.log("Error updating provider node:", error);
    return apiError(request, 500, "Failed to update provider node");
  }
});

// DELETE /api/provider-nodes/[id] - Delete provider node and its connections
export const DELETE = requireAuth(async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const node = await getProviderNodeById(id);

    if (!node) {
      return apiError(request, 404, "Provider node not found");
    }

    await deleteProviderConnectionsByProvider(id);
    await deleteProviderNode(id);
    invalidateLocalModelIndex();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting provider node:", error);
    return apiError(request, 500, "Failed to delete provider node");
  }
});
