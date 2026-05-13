/**
 * Smoke tests for GET /api/node/status
 *
 * Probes the sidecar /health endpoint. We mock global fetch so no real
 * network call is made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/sidecar so getSidecarUrl() returns a stable test URL
vi.mock("@/lib/sidecar", () => ({
  getSidecarUrl: () => "http://localhost:9480",
}));

// Mock next/server so NextResponse.json works in the test environment
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { "Content-Type": "application/json" },
    }),
  },
}));

// Mock global fetch — must be set before importing the route
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import the route after mocks are set up
import { GET } from "./route.js";

describe("GET /api/node/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns online:true when sidecar health returns 200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: "1.0.0" }),
    });

    const res = await GET();
    const body = await res.json();

    expect(body.online).toBe(true);
    expect(body.version).toBe("1.0.0");
  });

  it("returns online:false when fetch throws (timeout/offline)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));

    const res = await GET();
    const body = await res.json();

    expect(body.online).toBe(false);
    expect(body.error).toBeTruthy();
  });

  it("returns online:false when sidecar returns non-OK status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const res = await GET();
    const body = await res.json();

    expect(body.online).toBe(false);
    expect(body.error).toMatch(/503/);
  });
});
