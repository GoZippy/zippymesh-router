/**
 * Smoke tests for GET and POST /api/settings/mesh
 *
 * Verifies meshMode and meshAllowlist are returned/saved correctly and that
 * invalid meshMode values are rejected with HTTP 400.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/localDb before importing the route
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn().mockResolvedValue({ meshMode: "private", meshAllowlist: [] }),
  updateSettings: vi.fn().mockImplementation(async (updates) => ({
    meshMode: updates.meshMode ?? "private",
    meshAllowlist: updates.meshAllowlist ?? [],
  })),
}));

// Mock @/lib/apiErrors so we get a real Response with the right status code
// without pulling in open-sse / usageDb heavy dependencies
vi.mock("@/lib/apiErrors.js", () => ({
  apiError: (_req, status, message) =>
    new Response(JSON.stringify({ error: { message } }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
}));

// Mock next/server so NextResponse.json works outside Next.js runtime
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

// Import route handlers after all mocks are registered
import { GET, POST } from "./route.js";
import { getSettings, updateSettings } from "@/lib/localDb";

describe("GET /api/settings/mesh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({ meshMode: "private", meshAllowlist: [] });
  });

  it("returns meshMode and meshAllowlist", async () => {
    const res = await GET();
    const body = await res.json();

    expect(body).toHaveProperty("meshMode");
    expect(body).toHaveProperty("meshAllowlist");
  });

  it("returns the meshMode stored in settings", async () => {
    getSettings.mockResolvedValue({ meshMode: "cluster", meshAllowlist: ["node-1"] });
    const res = await GET();
    const body = await res.json();

    expect(body.meshMode).toBe("cluster");
    expect(body.meshAllowlist).toEqual(["node-1"]);
  });
});

describe("POST /api/settings/mesh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSettings.mockImplementation(async (updates) => ({
      meshMode: updates.meshMode ?? "private",
      meshAllowlist: updates.meshAllowlist ?? [],
    }));
  });

  it("rejects invalid meshMode with status 400", async () => {
    const req = { json: async () => ({ meshMode: "invalid" }) };
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("accepts valid meshMode 'public' with status 200", async () => {
    const req = { json: async () => ({ meshMode: "public", meshAllowlist: [] }) };
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meshMode).toBe("public");
  });

  it("accepts valid meshMode 'cluster'", async () => {
    const req = { json: async () => ({ meshMode: "cluster" }) };
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meshMode).toBe("cluster");
  });

  it("accepts valid meshMode 'private'", async () => {
    const req = { json: async () => ({ meshMode: "private" }) };
    const res = await POST(req);

    expect(res.status).toBe(200);
  });

  it("rejects when no valid fields are provided", async () => {
    const req = { json: async () => ({}) };
    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});
