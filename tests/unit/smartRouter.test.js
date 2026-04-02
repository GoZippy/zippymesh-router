import { describe, it, expect, beforeEach } from "vitest";
import {
  enrichResponse,
  RoutingMetrics,
} from "../../src/lib/routing/smartRouter.js";

describe("smartRouter - exported functions", () => {
  beforeEach(() => {
    // No setup needed for pure functions
  });

  describe("enrichResponse", () => {
    it("should add routing headers to response", () => {
      const headers = new Map();
      const mockResponse = {
        headers: {
          set: (k, v) => headers.set(k, v),
          get: (k) => headers.get(k),
        },
        status: 200,
        ok: true,
      };

      const metadata = {
        selected: "gpt-4o",
        intent: "code",
        score: 92,
        reason: "Excellent capabilities",
      };

      enrichResponse(mockResponse, metadata);

      expect(headers.get("x-selected-model")).toBe("gpt-4o");
      expect(headers.get("x-routing-intent")).toBe("code");
      expect(headers.get("x-routing-score")).toBe("92");
      expect(headers.get("x-routing-reason")).toBe("Excellent capabilities");
    });

    it("should handle fallback model info", () => {
      const headers = new Map();
      const mockResponse = {
        headers: {
          set: (k, v) => headers.set(k, v),
          get: (k) => headers.get(k),
        },
        status: 200,
        ok: true,
      };

      const metadata = {
        selected: "gpt-4o",
        usedModel: "claude-3",
        attemptNumber: 2,
      };

      enrichResponse(mockResponse, metadata);

      expect(headers.get("x-used-model")).toBe("claude-3");
      expect(headers.get("x-attempt-number")).toBe("2");
    });
  });

  describe("RoutingMetrics", () => {
    it("should track total requests", () => {
      const metrics = new RoutingMetrics();

      metrics.recordRequest({ selected: "gpt-4o", intent: "code" }, true, 1000);
      metrics.recordRequest({ selected: "claude-3", intent: "chat" }, true, 1200);

      const stats = metrics.getMetrics();
      expect(stats.totalRequests).toBe(2);
      expect(stats.successfulRequests).toBe(2);
    });

    it("should calculate success rate", () => {
      const metrics = new RoutingMetrics();

      metrics.recordRequest({ selected: "gpt-4o", intent: "code" }, true, 1000);
      metrics.recordRequest({ selected: "claude-3", intent: "code" }, false, 1200);

      const stats = metrics.getMetrics();
      expect(stats.successRate).toBe("50.00%");
    });

    it("should track by intent", () => {
      const metrics = new RoutingMetrics();

      metrics.recordRequest({ selected: "gpt-4o", intent: "code" }, true, 1000);
      metrics.recordRequest({ selected: "claude-3", intent: "code" }, true, 1200);
      metrics.recordRequest({ selected: "gpt-4o", intent: "chat" }, true, 1100);

      const stats = metrics.getMetrics();
      expect(stats.byIntent.code).toBe(2);
      expect(stats.byIntent.chat).toBe(1);
    });

    it("should track by model", () => {
      const metrics = new RoutingMetrics();

      metrics.recordRequest(
        { selected: "gpt-4o", usedModel: "gpt-4o", fallbackChain: ["gpt-4o"] },
        true,
        1000
      );
      metrics.recordRequest(
        { selected: "claude-3", usedModel: "claude-3", fallbackChain: ["claude-3"] },
        true,
        1200
      );

      const stats = metrics.getMetrics();
      expect(stats.byModel["gpt-4o"]).toBe(1);
      expect(stats.byModel["claude-3"]).toBe(1);
    });

    it("should track average latency", () => {
      const metrics = new RoutingMetrics();

      metrics.recordRequest({}, true, 1000);
      metrics.recordRequest({}, true, 1000);
      metrics.recordRequest({}, true, 2000);

      const stats = metrics.getMetrics();
      expect(stats.avgLatencyMs).toBe("1333");
    });

    it("should reset metrics", () => {
      const metrics = new RoutingMetrics();

      metrics.recordRequest({}, true, 1000);
      metrics.recordRequest({}, true, 2000);

      let stats = metrics.getMetrics();
      expect(stats.totalRequests).toBe(2);

      metrics.reset();
      stats = metrics.getMetrics();
      expect(stats.totalRequests).toBe(0);
      expect(stats.successfulRequests).toBe(0);
    });

    it("should track fallback depth", () => {
      const metrics = new RoutingMetrics();

      // First attempt (depth 1)
      metrics.recordRequest(
        { selected: "gpt-4o", usedModel: "gpt-4o", fallbackChain: ["gpt-4o", "claude-3"] },
        true,
        1000
      );

      // Second attempt (depth 2)
      metrics.recordRequest(
        { selected: "gpt-4o", usedModel: "claude-3", fallbackChain: ["gpt-4o", "claude-3"] },
        true,
        2000
      );

      const stats = metrics.getMetrics();
      expect(stats.byFallbackDepth[1]).toBe(1);
      expect(stats.byFallbackDepth[2]).toBe(1);
    });
  });
});
