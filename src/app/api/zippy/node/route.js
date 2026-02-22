import { NextResponse } from "next/server";
const zippyNodeManager = require('../../../../../sidecar/zippy-node-manager');

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

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (error) {
        console.error("Node Control Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
