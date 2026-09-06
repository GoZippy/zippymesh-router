import { createProviderNode, getProviderNodes, getNodeIdentity } from "../localDb.js";
import { signPayload } from "../security.js";
import { checkRegistrationTarget } from "../routing/hostClass.js";
import os from "node:os";

/* ------------------------------------------------------------------ *
 * Local runtime registration — shared by the LAN sweep (`scan()`) and
 * by the targeted `POST /api/provider-nodes {type:"local"}` fast path.
 *
 * Before 2026-08-30 the only way to tell ZMLR about a local Ollama was
 * `POST /api/discovery`, a 240 s sweep of every /24 of every non-internal
 * IPv4 interface that also registered the same runtime twice (once as
 * 127.0.0.1 and once as localhost, because the dedupe set was snapshotted
 * before the probe loop). Both problems are fixed here, in one place, so
 * the sweep and the fast path cannot drift apart.
 * ------------------------------------------------------------------ */

/** Host spellings that all mean "this machine". */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0", "::"]);

/**
 * Canonical `host:port` identity for a provider-node base URL.
 *
 * Every loopback spelling collapses to `localhost`, the port is defaulted per
 * scheme, and the path is ignored so `http://127.0.0.1:1234/v1` and
 * `http://localhost:1234` are recognised as the same runtime.
 *
 * @param {string} baseUrl
 * @returns {string|null} `host:port`, or null when the URL is unparseable.
 */
export function normalizeNodeKey(baseUrl) {
    if (!baseUrl || typeof baseUrl !== "string") return null;
    let url;
    try {
        url = new URL(baseUrl.trim());
    } catch {
        return null;
    }
    let host = url.hostname.toLowerCase();
    // Node returns bracketed IPv6 hostnames ("[::1]"); strip so the set matches.
    if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
    if (LOOPBACK_HOSTS.has(host)) host = "localhost";
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return `${host}:${port}`;
}

/**
 * The local runtimes a caller may name, and how to talk to each one.
 *
 * `storedApiType` is what goes in the `provider_nodes.apiType` column; the rest
 * of the app only distinguishes "ollama" from everything else (see
 * `syncLocalProviderConnection` in src/lib/localDb.js and the `ollama`/`lmstudio`
 * prefix choice in src/app/api/v1/models/route.js), so every OpenAI-shaped local
 * runtime is stored as `openai` and surfaces under the `lmstudio/` prefix.
 */
export const LOCAL_RUNTIME_PROFILES = {
    ollama: { storedApiType: "ollama", probePath: "/api/tags", label: "Ollama", appendV1: false, defaultPort: 11434 },
    lmstudio: { storedApiType: "openai", probePath: "/v1/models", label: "LM Studio", appendV1: true, defaultPort: 1234 },
    llamacpp: { storedApiType: "openai", probePath: "/v1/models", label: "llama.cpp", appendV1: true, defaultPort: 8080 },
    vllm: { storedApiType: "openai", probePath: "/v1/models", label: "vLLM", appendV1: true, defaultPort: 8000 },
    "openai-compatible": { storedApiType: "openai", probePath: "/v1/models", label: "Local OpenAI-compatible", appendV1: true, defaultPort: 8000 },
};

/** Spellings a client may send for an apiType, mapped to a profile key. */
const API_TYPE_ALIASES = {
    ollama: "ollama",
    lmstudio: "lmstudio",
    "lm-studio": "lmstudio",
    "lm studio": "lmstudio",
    llamacpp: "llamacpp",
    "llama.cpp": "llamacpp",
    "llama-cpp": "llamacpp",
    vllm: "vllm",
    openai: "openai-compatible",
    "openai-compatible": "openai-compatible",
    "openai_compatible": "openai-compatible",
};

/** @returns {string|null} the canonical profile key, or null when unsupported. */
export function resolveLocalApiType(apiType) {
    if (!apiType || typeof apiType !== "string") return null;
    return API_TYPE_ALIASES[apiType.trim().toLowerCase()] || null;
}

/** The supported `apiType` values, for error messages and docs. */
export const LOCAL_API_TYPES = Object.keys(LOCAL_RUNTIME_PROFILES);

/**
 * Split a user-supplied base URL into the runtime root (no trailing `/v1`, no
 * trailing slash) and the base URL that should be stored on the node.
 * @param {string} rawBaseUrl
 * @param {string} profileKey
 * @returns {{root: string, baseUrl: string}|null}
 */
export function normalizeLocalBaseUrl(rawBaseUrl, profileKey) {
    const profile = LOCAL_RUNTIME_PROFILES[profileKey];
    if (!profile || !rawBaseUrl || typeof rawBaseUrl !== "string") return null;

    let raw = rawBaseUrl.trim();
    if (!raw) return null;
    if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;

    let url;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }

    let path = url.pathname.replace(/\/+$/, "");
    if (/\/v1$/i.test(path)) path = path.slice(0, -3);
    const root = `${url.origin}${path}`.replace(/\/+$/, "");
    return { root, baseUrl: profile.appendV1 ? `${root}/v1` : root };
}

/**
 * Hard caps on what a probe will read back from an unvetted endpoint.
 *
 * Fix for H1 ("the success path exfiltrates any JSON body shaped .models[].name
 * verbatim") and M8 ("res.json() is unbounded: a hostile endpoint can stream as
 * much as it can deliver inside the 5 s window straight into heap").
 */
const PROBE_MAX_BODY_BYTES = 512 * 1024;
const PROBE_MAX_MODELS = 500;
const PROBE_MAX_MODEL_ID_CHARS = 128;

/**
 * Failure classes a probe may report. These are the ONLY failure strings that
 * ever reach a caller (H1): the upstream status code, the transport error text
 * and the response body are never echoed.
 */
export const PROBE_FAILURE = {
    UNREACHABLE: "unreachable",
    TIMEOUT: "timeout",
    UNEXPECTED_STATUS: "unexpected_status",
    BAD_RESPONSE: "bad_response",
    UNSUPPORTED: "unsupported_api_type",
};

/**
 * Keep a model id only if it is a plausible, printable, bounded identifier.
 * A rejected host used to be able to publish anything shaped `.models[].name`
 * into `/v1/models` — the review exfiltrated `SECRET-AWS-KEY-AKIAI0SECRET` and
 * `internal-host-db01.corp.local` that way.
 */
export function sanitizeModelIds(raw) {
    const out = [];
    if (!Array.isArray(raw)) return out;
    for (const value of raw) {
        if (out.length >= PROBE_MAX_MODELS) break;
        if (typeof value !== "string") continue;
        const id = value.trim();
        if (!id || id.length > PROBE_MAX_MODEL_ID_CHARS) continue;
        // Printable ASCII only: no control characters, no newlines, no NULs.
        if (!/^[\x21-\x7e]+(?: [\x21-\x7e]+)*$/.test(id)) continue;
        out.push(id);
    }
    return out;
}

/**
 * Read at most `PROBE_MAX_BODY_BYTES` of a response and JSON.parse it.
 * Returns null on any failure — including the body being longer than the cap,
 * which is treated as a hostile/unusable answer rather than truncated.
 */
async function readCappedJson(res) {
    if (!res.body) {
        // No readable stream. A real undici Response always has one; this is the
        // path for a polyfill or a test double. Still bounded by the caller's
        // AbortController, just not by byte count.
        if (typeof res.text === "function") {
            const text = await res.text();
            if (text.length > PROBE_MAX_BODY_BYTES) return null;
            return JSON.parse(text);
        }
        return await res.json();
    }
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > PROBE_MAX_BODY_BYTES) {
                try { await reader.cancel(); } catch { /* already gone */ }
                return null;
            }
            chunks.push(value);
        }
    } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
    }
    const buf = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { buf.set(c, at); at += c.byteLength; }
    return JSON.parse(new TextDecoder().decode(buf));
}

/**
 * Ask a local runtime what it serves. Never throws.
 *
 * The 5 s AbortController covers connect AND read (the timer is cleared in
 * `finally`, after the body read). Fixed 2026-08-30 (M8): an abort DURING the
 * body read used to be swallowed by the inner catch, so the function returned
 * `ok:true` and the node was registered as healthy. It now fails closed.
 *
 * @param {string} root - runtime root (no trailing `/v1`)
 * @param {string} profileKey
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, status: number|null, models: string[], error: string|null}>}
 *   `error` is one of PROBE_FAILURE — never the upstream status or message.
 */
export async function probeLocalRuntime(root, profileKey, timeoutMs = 5000) {
    const profile = LOCAL_RUNTIME_PROFILES[profileKey];
    if (!profile) return { ok: false, status: null, models: [], error: PROBE_FAILURE.UNSUPPORTED };

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(250, timeoutMs));
    try {
        // redirect:"manual" so the host-class allow-list cannot be bypassed by a
        // loopback/RFC1918 URL that 302-redirects the probe to a public or
        // cloud-metadata host (2026-08-30 adversarial verify V-1). A 3xx is
        // treated as an unexpected status, never followed.
        const res = await fetch(`${root}${profile.probePath}`, { signal: controller.signal, redirect: "manual" });
        // The status is deliberately kept OUT of `error` — reflecting it turned
        // this route into a firewall mapper (H1). It is still returned as
        // `status` for the server's own logs.
        if (!res.ok || (res.status >= 300 && res.status < 400)) {
            return { ok: false, status: res.status, models: [], error: PROBE_FAILURE.UNEXPECTED_STATUS };
        }

        let models = [];
        let readFailed = false;
        try {
            const data = await readCappedJson(res);
            if (data === null) {
                readFailed = true;
            } else {
                models = sanitizeModelIds(
                    profileKey === "ollama"
                        ? (data?.models || []).map((m) => m?.name)
                        : (data?.data || []).map((m) => m?.id)
                );
            }
        } catch {
            // A runtime that answers 200 with a non-JSON body is still "up";
            // /v1/models re-fetches the list anyway. But an ABORT here is not
            // "up" — see below.
            readFailed = controller.signal.aborted;
        }
        // M8: fail closed when the read was aborted or over the cap.
        if (controller.signal.aborted) {
            return { ok: false, status: null, models: [], error: timedOut ? PROBE_FAILURE.TIMEOUT : PROBE_FAILURE.UNREACHABLE };
        }
        if (readFailed) return { ok: false, status: res.status, models: [], error: PROBE_FAILURE.BAD_RESPONSE };

        return { ok: true, status: res.status, models, error: null };
    } catch (e) {
        const aborted = e?.name === "AbortError" || controller.signal.aborted;
        return {
            ok: false, status: null, models: [],
            error: aborted && timedOut ? PROBE_FAILURE.TIMEOUT : PROBE_FAILURE.UNREACHABLE,
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Register (or find) one local runtime.
 *
 * This is the single registration code path: `POST /api/provider-nodes
 * {type:"local"}` calls it once with a known URL, and `scan()` calls it for
 * every endpoint the sweep found. `createProviderNode` then syncs the
 * auto-managed provider connection (`syncLocalProviderConnection`), which is
 * what makes the node a routing candidate immediately.
 *
 * @param {object} input
 * @param {string} input.baseUrl        - e.g. "http://127.0.0.1:11434"
 * @param {string} input.apiType        - ollama | lmstudio | llamacpp | vllm | openai-compatible
 * @param {string} [input.name]
 * @param {string} [input.prefix]
 * @param {number} [input.timeoutMs=5000]
 * @param {boolean} [input.probe=true]  - false only when the caller already probed
 * @param {string[]} [input.models]     - pre-probed model list (with probe:false)
 * @param {Array} [input.existingNodes] - pass a snapshot to avoid re-reading the DB
 * @param {boolean} [input.allowRemote] - opt in to a link-local / unresolvable host
 * @param {boolean} [input.isAdmin]     - the caller holds an admin session
 * @param {boolean} [input.skipHostCheck] - internal: the LAN sweep already only
 *   probes addresses it enumerated from this machine's own interfaces
 * @returns {Promise<{ok:boolean, created:boolean, node:object|null, models:string[], key:string|null, error:string|null, status:number|null, hostClass:string|null}>}
 */
export async function registerLocalRuntime(input = {}) {
    const profileKey = resolveLocalApiType(input.apiType);
    if (!profileKey) {
        return { ok: false, created: false, node: null, models: [], key: null, status: 400, hostClass: null, error: `Unsupported apiType "${input.apiType}". Use one of: ${LOCAL_API_TYPES.join(", ")}` };
    }

    const normalized = normalizeLocalBaseUrl(input.baseUrl, profileKey);
    if (!normalized) {
        return { ok: false, created: false, node: null, models: [], key: null, status: 400, hostClass: null, error: `Invalid baseUrl ${JSON.stringify(input.baseUrl)}` };
    }

    /* ---------------------------------------------------------------- *
     * SSRF gate (H1 / C1b, added 2026-08-30).
     *
     * `type:"local"` was a naming convention, not a constraint: any parseable
     * host was accepted, fetched, and turned into a routing target. The gate
     * lives in src/lib/routing/hostClass.js — read its header for the policy
     * and for what it deliberately does not defend against.
     * ---------------------------------------------------------------- */
    let hostClass = null;
    if (input.skipHostCheck !== true) {
        const gate = await checkRegistrationTarget(normalized.root, {
            allowRemote: input.allowRemote === true,
            isAdmin: input.isAdmin === true,
        });
        hostClass = gate.hostClass;
        if (!gate.allowed) {
            return { ok: false, created: false, node: null, models: [], key: null, status: 403, hostClass, error: gate.reason };
        }
    }

    const profile = LOCAL_RUNTIME_PROFILES[profileKey];
    const key = normalizeNodeKey(normalized.baseUrl);

    // Dedupe against every local node already registered, by host:port, so
    // 127.0.0.1 / localhost / ::1 can never produce three rows for one runtime.
    let existing = input.existingNodes;
    if (!Array.isArray(existing)) {
        try {
            existing = await getProviderNodes();
        } catch {
            existing = [];
        }
    }
    const duplicate = existing.find(
        (n) => n?.type === "local" && normalizeNodeKey(n.baseUrl) === key
    );
    if (duplicate) {
        return { ok: true, created: false, node: duplicate, models: sanitizeModelIds(input.models), key, status: 200, hostClass, error: null };
    }

    let models = sanitizeModelIds(input.models);
    if (input.probe !== false) {
        const probed = await probeLocalRuntime(normalized.root, profileKey, input.timeoutMs ?? 5000);
        if (!probed.ok) {
            // `probed.error` is a PROBE_FAILURE class, never the upstream status
            // or transport text — the three distinct strings this used to emit
            // (`fetch failed` / `timed out after 5000ms` / `HTTP <status>`) were
            // a precise port scanner and firewall mapper (H1).
            return { ok: false, created: false, node: null, models: [], key, status: 502, hostClass, error: `No ${profile.label} runtime responded at ${normalized.root}${profile.probePath} (${probed.error})` };
        }
        models = probed.models;
    }

    const host = (() => {
        try { return new URL(normalized.root).hostname; } catch { return "local"; }
    })();

    const node = await createProviderNode({
        type: "local",
        name: (input.name && String(input.name).trim()) || `${profile.label} (${host})`,
        baseUrl: normalized.baseUrl,
        apiType: profile.storedApiType,
        prefix: (input.prefix && String(input.prefix).trim()) || `local-${profileKey}-`,
    });

    return { ok: true, created: true, node, models, key, status: 201, hostClass, error: null };
}

/**
 * Gate for the LOCAL UDP P2P discovery beacon (port 20129).
 *
 * Default: DISABLED. The beacon only ever binds a socket / starts a timer when
 * this returns true. This keeps module import, build, and tests completely
 * side-effect-free: importing this file opens no socket and starts no timer.
 *
 * Enable by setting the env var ENABLE_P2P_DISCOVERY to "true" or "1".
 * (Blockchain/contract heartbeat is a separate, out-of-scope concern.)
 *
 * @returns {boolean}
 */
export function isP2PDiscoveryEnabled() {
    const flag = (process.env.ENABLE_P2P_DISCOVERY || "").trim().toLowerCase();
    return flag === "true" || flag === "1" || flag === "yes" || flag === "on";
}

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
     * Scan for local services including subnet-wide discovery.
     *
     * Dedupe note (fixed 2026-08-30): the probe phase collects every endpoint
     * that answered, then a SINGLE-THREADED provisioning phase registers them
     * through `registerLocalRuntime`, which dedupes by normalized host:port.
     * Previously the "already exists" check compared raw base URLs against a
     * snapshot taken before the loop, so one Ollama reachable as both
     * 127.0.0.1 and localhost was registered twice.
     */
    async scan() {
        console.log("[Discovery] Starting local network scan...");
        const results = [];
        const targets = [...this.scanTargets];

        // Discover local subnet
        try {
            const interfaces = os.networkInterfaces();
            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                    // Skip internal and non-IPv4 addresses
                    if (iface.internal || iface.family !== 'IPv4') continue;

                    // Get first 3 octets
                    const subnet = iface.address.split('.').slice(0, 3).join('.');
                    console.log(`[Discovery] Detected subnet from ${iface.address}: ${subnet}.0/24`);

                    // Add all IPs in subnet (1-254)
                    for (let i = 1; i <= 254; i++) {
                        const ip = `${subnet}.${i}`;
                        if (!targets.includes(ip)) targets.push(ip);
                    }
                }
            }
        } catch (err) {
            console.error("[Discovery] Failed to detect subnet:", err);
        }

        const uniqueTargets = [...new Set(targets)];
        console.log(`[Discovery] Probing ${uniqueTargets.length} potential targets...`);

        // Scan in batches to avoid overwhelming the network/system
        const batchSize = 15;
        for (let i = 0; i < uniqueTargets.length; i += batchSize) {
            const batch = uniqueTargets.slice(i, i + batchSize);
            const batchPromises = batch.flatMap((target, offset) => {
                const order = i + offset;
                return this.commonPorts.map(async ({ port, type, name }) => {
                    const url = `http://${target}:${port}`;
                    const probed = await probeLocalRuntime(url, resolveLocalApiType(type) || "openai-compatible", 1000);
                    if (!probed.ok) return;
                    results.push({
                        apiType: type,
                        name: `${name} (${target})`,
                        baseUrl: url,
                        prefix: `local-${type}-`,
                        models: probed.models,
                        order,
                        port,
                    });
                });
            });
            await Promise.all(batchPromises);
        }

        // Deterministic order: the explicit scan targets (127.0.0.1 first) win
        // over subnet addresses, so the surviving node for a loopback runtime is
        // always the 127.0.0.1 one regardless of Promise.all completion order.
        results.sort((a, b) => (a.order - b.order) || (a.port - b.port));
        console.log(`[Discovery] Scan complete. ${results.length} endpoint(s) answered.`);

        // Auto-provision, single-threaded, sharing one dedupe view of the DB.
        const provisioned = [];
        const known = (await getProviderNodes().catch(() => [])) || [];
        for (const res of results) {
            try {
                const outcome = await registerLocalRuntime({
                    baseUrl: res.baseUrl,
                    apiType: res.apiType,
                    name: res.name,
                    prefix: res.prefix,
                    probe: false,          // already probed above
                    models: res.models,
                    existingNodes: known,
                    // Every target here came from this machine's OWN interface
                    // list (or the two loopback spellings), so the SSRF gate has
                    // nothing to add and a DNS round trip per /24 address would
                    // be pure cost. Only the caller-supplied `baseUrl` path is
                    // gated.
                    skipHostCheck: true,
                });
                if (outcome.ok && outcome.created && outcome.node) {
                    known.push(outcome.node);
                    provisioned.push(outcome.node);
                }
            } catch (err) {
                // Ignore duplicates or DB errors
            }
        }

        console.log(`[Discovery] Provisioned ${provisioned.length} new node(s).`);
        if (provisioned.length > 0) {
            // /v1/models and the bare-tag resolver read a TTL-cached view of the
            // local runtimes; newly-scanned nodes must appear immediately.
            try {
                const { invalidateLocalModelIndex } = await import("../routing/localModelIndex.js");
                invalidateLocalModelIndex();
            } catch { /* non-fatal */ }
        }
        return provisioned;
    }

    /**
     * Start broadcasting presence on the network.
     *
     * GATED: when ENABLE_P2P_DISCOVERY is not set (the default), this is a safe
     * no-op that opens NO socket and starts NO timer. Only when the flag is
     * enabled does it bind the UDP socket and schedule the broadcast interval.
     *
     * @returns {Promise<boolean>} true if the beacon was started, false if
     *   it was skipped (disabled or already running).
     */
    async startBeacon() {
        if (!isP2PDiscoveryEnabled()) {
            console.log("[Discovery] P2P beacon disabled (set ENABLE_P2P_DISCOVERY=true to enable). No socket opened.");
            return false;
        }
        if (this.beaconTimer) return false;

        const dgram = await import("node:dgram");
        const jose = await import("jose");
        this.udpSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });

        const { verifyPayload } = await import("../security.js");

        // Our own identity, so we can skip provisioning ourselves from our own broadcast.
        let selfPublicKey = null;
        try {
            selfPublicKey = (await getNodeIdentity())?.publicKey || null;
        } catch {
            // Identity unavailable — fall back to address-based self-filtering only.
        }
        const selfName = process.env.ZIPPY_NODE_NAME || os.hostname();

        this.udpSocket.on("message", async (msg, rinfo) => {
            try {
                const token = msg.toString();

                // The sender includes their publicKey in the payload; verify the
                // JWT *with* that key so we can authenticate the beacon.
                const decoded = jose.decodeJwt(token);
                if (!decoded.publicKey) return;

                const payload = await verifyPayload(token, decoded.publicKey);

                if (payload.type === "zippymesh-node") {
                    // Ignore our own beacons (loopback / same pubkey / same name).
                    if (
                        rinfo.address === "127.0.0.1" ||
                        (selfPublicKey && payload.publicKey === selfPublicKey) ||
                        payload.name === selfName
                    ) {
                        return;
                    }

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

        // Never let a socket error crash the process; tear down cleanly instead.
        this.udpSocket.on("error", (err) => {
            console.error("[Discovery] Beacon socket error:", err.message);
            this.stopBeacon();
        });

        this.udpSocket.bind(this.beaconPort, () => {
            try {
                this.udpSocket.setBroadcast(true);
            } catch {
                // Some platforms require the socket to be bound first; ignore failures.
            }
        });

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
        return true;
    }

    /**
     * Stop broadcasting. Safe to call at any time, including when the beacon was
     * never started (no-op) or already stopped.
     */
    stopBeacon() {
        if (this.beaconTimer) {
            clearInterval(this.beaconTimer);
            this.beaconTimer = null;
        }
        if (this.udpSocket) {
            try {
                this.udpSocket.close();
            } catch {
                // Socket may already be closed / never bound — ignore.
            }
            this.udpSocket = null;
        }
    }

    /**
     * Probe a URL to see if an LLM engine is responding.
     * Thin wrapper over the shared `probeLocalRuntime` so the sweep, the fast
     * path and any existing caller agree on what "reachable" means.
     */
    async probe(url, type) {
        const profileKey = resolveLocalApiType(type) || "openai-compatible";
        const { ok } = await probeLocalRuntime(url, profileKey, 1000);
        return ok;
    }
}

export const discoveryService = new LocalDiscoveryService();
