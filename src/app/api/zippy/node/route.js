import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import path from "path";
import { createRequire } from "module";

let zippyNodeManager;
try {
  const require = createRequire(import.meta.url);
  const sidecarPath = path.join(process.cwd(), "sidecar", "zippy-node-manager.js");
  zippyNodeManager = require(sidecarPath);
} catch {
  zippyNodeManager = {
    getLogs: () => [],
    getStatus: () => ({ running: false, error: "Sidecar manager not loaded" }),
    start: async () => {},
    stop: async () => {},
    dialPeer: async () => ({}),
    blockPeer: async () => ({}),
  };
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const logs = searchParams.get('logs');

    if (logs === 'true') {
        return NextResponse.json(zippyNodeManager.getLogs());
    }

    const status = zippyNodeManager.getStatus();
    return NextResponse.json(status);
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { action, mode, broadcast, peerId, multiaddr } = body;

        if (action === 'start') {
            await zippyNodeManager.start(mode, broadcast);
            return NextResponse.json({ message: "Node started successfully" });
        }

        if (action === 'stop') {
            await zippyNodeManager.stop();
            return NextResponse.json({ message: "Node stopped successfully" });
        }

        if (action === 'dialPeer') {
            const result = await zippyNodeManager.dialPeer(multiaddr);
            return NextResponse.json(result);
        }

        if (action === 'blockPeer') {
            const result = await zippyNodeManager.blockPeer(peerId);
            return NextResponse.json(result);
        }

        return apiError(request, 400, "Invalid action");
    } catch (error) {
        console.error("Node Control Error:", error);
        return apiError(request, 500, error.message || "Node control failed");
    }
}
