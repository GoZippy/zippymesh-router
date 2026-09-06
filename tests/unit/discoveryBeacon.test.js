import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * Tests for the LOCAL UDP P2P discovery beacon gate (port 20129).
 *
 * SAFETY: these tests must NEVER bind a real UDP socket (port-conflict / flaky).
 * We therefore:
 *   1. Force the feature flag OFF so startBeacon()/start() take the no-op path.
 *   2. Mock node:dgram so even an accidental socket-creation path can't touch
 *      the OS — and we assert createSocket() is never called.
 *   3. Mock ../../src/lib/localDb.js so importing the modules touches no DB.
 *
 * We assert the disabled-by-default contract: no socket, no timer, and that
 * stop() / stopBeacon() are always safe to call.
 */

const { mockCreateSocket, mockLocalDb, mockSecurity } = vi.hoisted(() => ({
    // If this is ever called, the test fails the "no socket" assertion.
    mockCreateSocket: vi.fn(() => {
        throw new Error("dgram.createSocket must not be called when discovery is disabled");
    }),
    mockLocalDb: {
        createProviderNode: vi.fn().mockResolvedValue({ id: "node-1" }),
        getProviderNodes: vi.fn().mockResolvedValue([]),
        getNodeIdentity: vi.fn().mockResolvedValue({ publicKey: "PUB", privateKey: "PRIV" }),
        createProviderConnection: vi.fn().mockResolvedValue({ id: "conn-1" }),
    },
    mockSecurity: {
        signPayload: vi.fn().mockResolvedValue("signed.jwt.token"),
        verifyPayload: vi.fn().mockResolvedValue({ type: "zippymesh-node" }),
    },
}));

vi.mock("node:dgram", () => ({
    default: { createSocket: mockCreateSocket },
    createSocket: mockCreateSocket,
}));

vi.mock("../../src/lib/localDb.js", () => mockLocalDb);
vi.mock("../../src/lib/security.js", () => mockSecurity);

import {
    isP2PDiscoveryEnabled,
    discoveryService,
    LocalDiscoveryService,
} from "../../src/lib/discovery/localDiscovery.js";
import { p2pDiscovery, P2PDiscoveryService } from "../../src/lib/discovery/p2pDiscovery.js";

describe("P2P discovery beacon gate (ENABLE_P2P_DISCOVERY)", () => {
    const ORIGINAL_FLAG = process.env.ENABLE_P2P_DISCOVERY;

    beforeEach(() => {
        vi.clearAllMocks();
        // Default-disabled: ensure the flag is unset for every test.
        delete process.env.ENABLE_P2P_DISCOVERY;
    });

    afterEach(() => {
        if (ORIGINAL_FLAG === undefined) delete process.env.ENABLE_P2P_DISCOVERY;
        else process.env.ENABLE_P2P_DISCOVERY = ORIGINAL_FLAG;
    });

    describe("isP2PDiscoveryEnabled()", () => {
        it("is disabled by default (env var unset)", () => {
            delete process.env.ENABLE_P2P_DISCOVERY;
            expect(isP2PDiscoveryEnabled()).toBe(false);
        });

        it("is disabled for falsey / unrelated values", () => {
            for (const v of ["", "false", "0", "no", "off", "nope"]) {
                process.env.ENABLE_P2P_DISCOVERY = v;
                expect(isP2PDiscoveryEnabled()).toBe(false);
            }
        });

        it("is enabled only for explicit truthy values", () => {
            for (const v of ["true", "1", "yes", "on", "TRUE", " On "]) {
                process.env.ENABLE_P2P_DISCOVERY = v;
                expect(isP2PDiscoveryEnabled()).toBe(true);
            }
        });
    });

    describe("LocalDiscoveryService.startBeacon() — disabled", () => {
        it("is a no-op that opens no socket and starts no timer", async () => {
            const svc = new LocalDiscoveryService();
            const result = await svc.startBeacon();

            expect(result).toBe(false);
            expect(mockCreateSocket).not.toHaveBeenCalled();
            expect(svc.udpSocket).toBeNull();
            expect(svc.beaconTimer).toBeNull();
        });

        it("stopBeacon() is safe to call when never started", () => {
            const svc = new LocalDiscoveryService();
            expect(() => svc.stopBeacon()).not.toThrow();
            // Idempotent: calling again is still safe.
            expect(() => svc.stopBeacon()).not.toThrow();
            expect(svc.udpSocket).toBeNull();
            expect(svc.beaconTimer).toBeNull();
        });

        it("exported singleton behaves identically (no socket while disabled)", async () => {
            const result = await discoveryService.startBeacon();
            expect(result).toBe(false);
            expect(mockCreateSocket).not.toHaveBeenCalled();
            expect(() => discoveryService.stopBeacon()).not.toThrow();
        });
    });

    describe("P2PDiscoveryService.start() — disabled", () => {
        it("is a no-op that opens no socket and is not listening", async () => {
            const svc = new P2PDiscoveryService();
            const result = await svc.start();

            expect(result).toBe(false);
            expect(mockCreateSocket).not.toHaveBeenCalled();
            expect(svc.socket).toBeNull();
            expect(svc.isListening).toBe(false);
        });

        it("startBeacon() alias is also a disabled no-op", async () => {
            const svc = new P2PDiscoveryService();
            const result = await svc.startBeacon();
            expect(result).toBe(false);
            expect(mockCreateSocket).not.toHaveBeenCalled();
            expect(svc.socket).toBeNull();
        });

        it("stop()/stopBeacon() are safe to call when never started", () => {
            const svc = new P2PDiscoveryService();
            expect(() => svc.stop()).not.toThrow();
            expect(() => svc.stopBeacon()).not.toThrow();
            expect(svc.socket).toBeNull();
            expect(svc.isListening).toBe(false);
        });

        it("exported singleton behaves identically (no socket while disabled)", async () => {
            const result = await p2pDiscovery.start();
            expect(result).toBe(false);
            expect(mockCreateSocket).not.toHaveBeenCalled();
            expect(() => p2pDiscovery.stop()).not.toThrow();
        });
    });

    describe("import-time safety", () => {
        it("importing the discovery modules opened no socket", () => {
            // The imports at the top of this file already executed; if any module
            // bound a socket at import time, createSocket would have been called.
            expect(mockCreateSocket).not.toHaveBeenCalled();
        });
    });
});
