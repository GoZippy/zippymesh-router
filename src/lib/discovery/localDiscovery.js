import { createProviderNode, getProviderNodes } from "../localDb.js";

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

        this.scanTargets = ["127.0.0.1", "localhost"];
        this.beaconPort = 20129; // Separate port for P2P discovery
        this.beaconInterval = 30000; // 30 seconds
        this.beaconTimer = null;
        this.udpSocket = null;
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

        this.beaconTimer = setInterval(() => {
            try {
                const message = JSON.stringify({
                    type: "zippymesh-node",
                    version: "1.0.0",
                    port: 20128, // Main API port
                    name: os.hostname()
                });

                this.udpSocket.send(message, this.beaconPort, "255.255.255.255", (err) => {
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
