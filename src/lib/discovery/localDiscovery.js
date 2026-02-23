import { createProviderNode, getProviderNodes, getNodeIdentity } from "../localDb.js";
import { signPayload } from "../security.js";
import os from "node:os";

/**
 * LocalDiscoveryService
 * Scans for local and network LLM engines (Ollama, LM Studio, etc.)
 */
export class LocalDiscoveryService {
    constructor() {
        this.commonPorts = [
            { port: 11434, type: "ollama", name: "Ollama" },
            { port: 1234, type: "lmstudio", name: "LM Studio" },
            { port: 8080, type: "llamacpp", name: "Llama.cpp / Text Gen UI" },
            { port: 8000, type: "vllm", name: "vLLM" }
        ];

        this.jose = null;
        this.importJose();

        this.scanTargets = ["127.0.0.1", "localhost"];
        this.beaconPort = parseInt(process.env.ZIPPY_DISCOVERY_PORT || "20129", 10);
        this.beaconInterval = parseInt(process.env.ZIPPY_BEACON_INTERVAL || "30000", 10);
        this.beaconTimer = null;
        this.udpSocket = null;
    }

    async importJose() {
        this.jose = await import("jose");
    }

    /**
     * Scan for local services
     */
    async scan() {
        const results = [];
        const existingNodes = await getProviderNodes();

        for (const target of this.scanTargets) {
            for (const { port, type, name } of this.commonPorts) {
                const url = `http://${target}:${port}`;
                const isFound = await this.probe(url, type);

                if (isFound) {
                    // Check if already exists
                    const exists = existingNodes.find(n => n.baseUrl === url || n.baseUrl === `${url}/v1`);
                    if (!exists) {
                        results.push({
                            type: "local",
                            name: `${name} (${target})`,
                            baseUrl: type === "ollama" ? url : `${url}/v1`,
                            apiType: type === "ollama" ? "ollama" : "openai",
                            prefix: `local-${type}-`
                        });
                    }
                }
            }
        }

        // Auto-provision discovered nodes
        const provisioned = [];
        for (const res of results) {
            const node = await createProviderNode(res);
            provisioned.push(node);
        }

        return provisioned;
    }

    /**
     * Start broadcasting presence on the network
     */
    async startBeacon() {
        if (this.beaconTimer) return;

        const dgram = await import("node:dgram");
        this.udpSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });

        const { verifyPayload } = await import("../security.js");

        this.udpSocket.on("message", async (msg, rinfo) => {
            try {
                // Ignore our own beacons if we wanted to, but simple verification handles all
                const token = msg.toString();

                // 1. Decode header to extract public key (or it's in the payload)
                // In our case, the sender includes their publicKey in the payload
                // but we need to verify the JWT *with* that key.
                const decoded = jose.decodeJwt(token);
                if (!decoded.publicKey) return;

                const payload = await verifyPayload(token, decoded.publicKey);

                if (payload.type === "zippymesh-node") {
                    console.log(`[Discovery] Verified node: ${payload.name} at ${rinfo.address}`);

                    const url = `http://${rinfo.address}:${payload.port}/api/v1`;
                    const existingNodes = await getProviderNodes();
                    const exists = existingNodes.find(n => n.baseUrl === url);

                    if (!exists) {
                        await createProviderNode({
                            type: "peer",
                            name: payload.name,
                            baseUrl: url,
                            apiType: "openai",
                            prefix: "peer-",
                            providerSpecificData: {
                                publicKey: payload.publicKey,
                                version: payload.version
                            }
                        });
                        console.log(`[Discovery] Provisioned peer node: ${payload.name}`);
                    }
                }
            } catch (err) {
                // Verification failed - likely invalid signature or malformed token
                // We ignore silently or log briefly
            }
        });

        this.udpSocket.bind(this.beaconPort);

        this.beaconTimer = setInterval(async () => {
            try {
                const identity = await getNodeIdentity();
                const payload = {
                    type: "zippymesh-node",
                    version: "1.0.0",
                    port: parseInt(process.env.ZIPPY_PORT || "20128", 10),
                    name: process.env.ZIPPY_NODE_NAME || os.hostname(),
                    publicKey: identity.publicKey
                };

                const token = await signPayload(payload);

                this.udpSocket.send(token, this.beaconPort, "255.255.255.255", (err) => {
                    if (err) console.error("[Discovery] Beacon send error:", err.message);
                });
            } catch (err) {
                console.error("[Discovery] Beacon error:", err.message);
            }
        }, this.beaconInterval);

        console.log(`[Discovery] P2P Beacon started on port ${this.beaconPort}`);
    }

    /**
     * Stop broadcasting
     */
    stopBeacon() {
        if (this.beaconTimer) {
            clearInterval(this.beaconTimer);
            this.beaconTimer = null;
        }
        if (this.udpSocket) {
            this.udpSocket.close();
            this.udpSocket = null;
        }
    }

    /**
     * Probe a URL to see if an LLM engine is responding
     */
    async probe(url, type) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 1000); // 1s timeout

            let endpoint = "/";
            if (type === "ollama") endpoint = "/api/tags";
            else endpoint = "/v1/models";

            const res = await fetch(`${url}${endpoint}`, { signal: controller.signal });
            clearTimeout(id);

            return res.ok;
        } catch (e) {
            return false;
        }
    }
}

export const discoveryService = new LocalDiscoveryService();
