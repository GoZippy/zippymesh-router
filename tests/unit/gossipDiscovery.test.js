import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * Tests for GossipDiscoveryService (MSH01 — "make gossip primary discovery").
 *
 * This is the new primary mesh-peer discovery path: it polls the sidecar's
 * /peers endpoint (libp2p Gossipsub — mDNS + bootstrap peers + Kademlia DHT,
 * see sidecar/src/p2p.rs) instead of listening for UDP beacon broadcasts.
 * Unlike the UDP beacon (discoveryBeacon.test.js), it never opens a socket,
 * so there's no "disabled by default" gate to test — just fetch/DB behavior.
 */

const { mockGetSidecarPeers, mockCreateProviderNode, mockGetProviderNodes } =
  vi.hoisted(() => ({
    mockGetSidecarPeers: vi.fn(),
    mockCreateProviderNode: vi.fn(),
    mockGetProviderNodes: vi.fn(),
  }));

vi.mock("../../src/lib/sidecar.js", () => ({
  getSidecarPeers: mockGetSidecarPeers,
}));

vi.mock("../../src/lib/localDb.js", () => ({
  createProviderNode: mockCreateProviderNode,
  getProviderNodes: mockGetProviderNodes,
}));

import { GossipDiscoveryService } from "../../src/lib/discovery/gossipDiscovery.js";

describe("GossipDiscoveryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderNodes.mockResolvedValue([]);
    mockCreateProviderNode.mockImplementation(async (data) => ({
      id: "generated-id",
      ...data,
    }));
  });

  describe("syncOnce()", () => {
    it("returns [] when the sidecar has no peers", async () => {
      mockGetSidecarPeers.mockResolvedValue([]);
      const svc = new GossipDiscoveryService();

      const result = await svc.syncOnce();

      expect(result).toEqual([]);
      expect(mockCreateProviderNode).not.toHaveBeenCalled();
    });

    it("returns [] and swallows errors when getSidecarPeers rejects", async () => {
      mockGetSidecarPeers.mockRejectedValue(new Error("sidecar unreachable"));
      const svc = new GossipDiscoveryService();

      const result = await svc.syncOnce();

      expect(result).toEqual([]);
      expect(mockCreateProviderNode).not.toHaveBeenCalled();
    });

    it("provisions a new peer discovered via gossipsub", async () => {
      mockGetSidecarPeers.mockResolvedValue([
        { id: "12D3KooWabc123", latency_ms: 42, models: [{ name: "llama3" }] },
      ]);
      mockGetProviderNodes.mockResolvedValue([]);
      const svc = new GossipDiscoveryService();

      const result = await svc.syncOnce();

      expect(result).toHaveLength(1);
      expect(mockCreateProviderNode).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "peer",
          baseUrl: "zippymesh-gossip://12D3KooWabc123",
          prefix: "peer-",
          metadata: expect.objectContaining({
            source: "gossipsub",
            peerId: "12D3KooWabc123",
          }),
        })
      );
    });

    it("skips peers already present in the local DB (dedup by baseUrl)", async () => {
      mockGetSidecarPeers.mockResolvedValue([{ id: "existing-peer" }]);
      mockGetProviderNodes.mockResolvedValue([
        { id: "n1", baseUrl: "zippymesh-gossip://existing-peer" },
      ]);
      const svc = new GossipDiscoveryService();

      const result = await svc.syncOnce();

      expect(result).toEqual([]);
      expect(mockCreateProviderNode).not.toHaveBeenCalled();
    });

    it("skips peers with no id or peer_id", async () => {
      mockGetSidecarPeers.mockResolvedValue([{ latency_ms: 5 }]);
      const svc = new GossipDiscoveryService();

      const result = await svc.syncOnce();

      expect(result).toEqual([]);
      expect(mockCreateProviderNode).not.toHaveBeenCalled();
    });

    it("accepts peer_id as an alternate id field", async () => {
      mockGetSidecarPeers.mockResolvedValue([{ peer_id: "alt-id-peer" }]);
      const svc = new GossipDiscoveryService();

      const result = await svc.syncOnce();

      expect(result).toHaveLength(1);
      expect(mockCreateProviderNode).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "zippymesh-gossip://alt-id-peer" })
      );
    });

    it("provisions multiple new peers in one pass, skipping only duplicates", async () => {
      mockGetSidecarPeers.mockResolvedValue([
        { id: "peer-a" },
        { id: "peer-b" },
      ]);
      mockGetProviderNodes.mockResolvedValue([
        { id: "n1", baseUrl: "zippymesh-gossip://peer-a" },
      ]);
      const svc = new GossipDiscoveryService();

      const result = await svc.syncOnce();

      expect(result).toHaveLength(1);
      expect(mockCreateProviderNode).toHaveBeenCalledTimes(1);
      expect(mockCreateProviderNode).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "zippymesh-gossip://peer-b" })
      );
    });

    it("does not throw when createProviderNode rejects for one peer", async () => {
      mockGetSidecarPeers.mockResolvedValue([{ id: "bad-peer" }]);
      mockCreateProviderNode.mockRejectedValueOnce(new Error("db error"));
      const svc = new GossipDiscoveryService();

      const result = await svc.syncOnce();

      expect(result).toEqual([]);
    });
  });

  describe("start() / stop()", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockGetSidecarPeers.mockResolvedValue([]);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("start() returns true and runs an immediate sync pass", () => {
      const svc = new GossipDiscoveryService();
      const result = svc.start();

      expect(result).toBe(true);
      expect(mockGetSidecarPeers).toHaveBeenCalledTimes(1);
      svc.stop();
    });

    it("start() is idempotent — calling twice does not double the timer", () => {
      const svc = new GossipDiscoveryService();
      expect(svc.start()).toBe(true);
      expect(svc.start()).toBe(false);
      svc.stop();
    });

    it("polls again after the configured interval", async () => {
      const svc = new GossipDiscoveryService();
      svc.pollIntervalMs = 1000;
      svc.start();
      expect(mockGetSidecarPeers).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(mockGetSidecarPeers).toHaveBeenCalledTimes(2);

      svc.stop();
    });

    it("stop() clears the timer and is safe to call when never started", () => {
      const svc = new GossipDiscoveryService();
      expect(() => svc.stop()).not.toThrow();

      svc.start();
      svc.stop();
      expect(svc.timer).toBeNull();

      // idempotent
      expect(() => svc.stop()).not.toThrow();
    });
  });
});
