import dgram from "node:dgram";
import { createProviderNode, getProviderNodes, createProviderConnection } from "../localDb.js";
import os from "node:os";

/**
 * P2PDiscoveryService
 * Listens for UDP beacons from other ZippyMesh nodes and registers them.
 */
export class P2PDiscoveryService {
    constructor() {
        this.beaconPort = 20129;
        this.socket = null;
        this.isListening = false;
    }

    /**
     * Start listening for peer beacons
     */
    async start() {
        if (this.isListening) return;

        this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

        this.socket.on("message", async (msg, rinfo) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.type === "zippymesh-node") {
                    await this.handlePeer(data, rinfo.address);
                }
            } catch (err) {
                // Silently ignore malformed packets
            }
        });

        this.socket.on("error", (err) => {
            console.error("[P2P] Socket error:", err.message);
            this.stop();
        });

        this.socket.bind(this.beaconPort, () => {
            this.isListening = true;
            console.log(`[P2P] Listening for peers on port ${this.beaconPort}`);
        });
    }

    /**
     * Stop listening
     */
    stop() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.isListening = false;
    }

    /**
     * Handle discovered peer
     */
    async handlePeer(data, ip) {
        // Don't register ourselves
        const myHost = os.hostname();
        if (data.name === myHost || ip === "127.0.0.1") return;

        const existingNodes = await getProviderNodes();
        const baseUrl = `http://${ip}:${data.port}/api/v1`;

        const exists = existingNodes.find(n => n.baseUrl === baseUrl);
        if (!exists) {
            console.log(`[P2P] Discovered new peer node: ${data.name} (${ip})`);
            const node = await createProviderNode({
                type: "peer",
                name: `Peer: ${data.name}`,
                baseUrl: baseUrl,
                apiType: "openai",
                prefix: "peer-"
            });

            // Auto-provision a connection for this peer
            await createProviderConnection({
                provider: "peer",
                name: `Mesh: ${data.name}`,
                apiKey: "p2p-mesh-token",
                baseUrl: baseUrl,
                isActive: true,
                providerSpecificData: {
                    nodeId: node.id
                }
            });
        }
    }
}

export const p2pDiscovery = new P2PDiscoveryService();
