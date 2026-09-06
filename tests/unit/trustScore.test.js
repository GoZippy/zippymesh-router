/**
 * src/lib/trustScore.js and the two gates that consume it.
 *
 * THE BUG (adversarial review 2026-08-30, item 13): the module returned a
 * hard-coded 50 for every remote peer. The sidecar registers `GET /trust` for
 * the LOCAL node only — there is no `/trust/{peer_id}` handler in it — so the
 * per-peer call 404s and every remote peer scored exactly 50. `minTrustScore`
 * was therefore a placebo: > 50 dropped every remote peer, <= 50 admitted every
 * remote peer, and the rejection string quoted "Trust score 50" as a
 * measurement.
 *
 * THE FIX has two halves, and the second is the one that matters: unknown is
 * now `null`, AND both gates fail CLOSED on `null`. Returning null alone would
 * have flipped a filter that accidentally blocked into one that skipped — a
 * loosening dressed as a fix — because both guards were `trustScore != null`.
 *
 * Run ONLY: npx vitest run tests/unit/trustScore.test.js
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const sidecar = vi.hoisted(() => ({ fetchSidecarWithTimeout: vi.fn() }));
vi.mock("@/lib/sidecar.js", () => ({
  fetchSidecarWithTimeout: (...a) => sidecar.fetchSidecarWithTimeout(...a),
}));
vi.mock("../../src/lib/sidecar.js", () => ({
  fetchSidecarWithTimeout: (...a) => sidecar.fetchSidecarWithTimeout(...a),
}));

const { getTrustScore, meetsTrustThreshold } = await import("../../src/lib/trustScore.js");

const ok = (body) => ({ ok: true, json: async () => body });
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) });

beforeEach(() => {
  sidecar.fetchSidecarWithTimeout.mockReset();
});

describe("getTrustScore()", () => {
  it("returns null — not 50 — for a remote peer, because /trust/{peerId} does not exist", async () => {
    sidecar.fetchSidecarWithTimeout.mockImplementation(async (route) =>
      route === "/trust" ? ok({ node_id: "local-node", trust_score: 91 }) : notFound()
    );
    expect(await getTrustScore("some-remote-peer")).toBeNull();
  });

  it("still returns the real score for the LOCAL node", async () => {
    sidecar.fetchSidecarWithTimeout.mockImplementation(async () =>
      ok({ node_id: "local-node", trust_score: 91 })
    );
    expect(await getTrustScore("local-node")).toBe(91);
  });

  it("returns a real per-peer score if a sidecar ever registers the route", async () => {
    sidecar.fetchSidecarWithTimeout.mockImplementation(async (route) =>
      route === "/trust" ? ok({ node_id: "local-node" }) : ok({ trust_score: 73 })
    );
    expect(await getTrustScore("remote-1")).toBe(73);
  });

  it("returns null for a missing peerId, a non-ok /trust, a throwing sidecar and a non-numeric score", async () => {
    expect(await getTrustScore("")).toBeNull();

    sidecar.fetchSidecarWithTimeout.mockResolvedValue({ ok: false, status: 503 });
    expect(await getTrustScore("p")).toBeNull();

    sidecar.fetchSidecarWithTimeout.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await getTrustScore("p")).toBeNull();

    sidecar.fetchSidecarWithTimeout.mockImplementation(async (route) =>
      route === "/trust" ? ok({ node_id: "local" }) : ok({ trust_score: "high" })
    );
    expect(await getTrustScore("p")).toBeNull();
  });

  it("exports no fabricated default constant any more", async () => {
    const mod = await import("../../src/lib/trustScore.js");
    expect(mod.DEFAULT_TRUST_SCORE).toBeUndefined();
  });
});

describe("meetsTrustThreshold() fails closed", () => {
  beforeEach(() => {
    sidecar.fetchSidecarWithTimeout.mockImplementation(async (route) =>
      route === "/trust" ? ok({ node_id: "local-node" }) : notFound()
    );
  });

  it("rejects an unknown peer whenever a threshold is configured", async () => {
    expect(await meetsTrustThreshold("remote", 70)).toBe(false);
    // The cohort whose setting used to be a silent no-op (0 < min <= 50):
    // they now get the blocking their setting asked for.
    expect(await meetsTrustThreshold("remote", 10)).toBe(false);
  });

  it("admits everything when no threshold is set", async () => {
    expect(await meetsTrustThreshold("remote", 0)).toBe(true);
    expect(await meetsTrustThreshold("remote", null)).toBe(true);
    expect(await meetsTrustThreshold("remote", undefined)).toBe(true);
  });

  it("still compares a real score normally", async () => {
    sidecar.fetchSidecarWithTimeout.mockImplementation(async () =>
      ok({ node_id: "local-node", trust_score: 80 })
    );
    expect(await meetsTrustThreshold("local-node", 70)).toBe(true);
    expect(await meetsTrustThreshold("local-node", 90)).toBe(false);
  });
});

// ── the peers/filtered gate ──────────────────────────────────────────────────
//
// evaluatePeerFilters is not exported, so this drives the POST handler with
// checkAuth() and the DB reads mocked.

describe("POST /api/mesh/peers/filtered fails closed on unknown trust", () => {
  it("blocks an unscored peer and reports no fabricated number", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/middleware.js", () => ({ checkAuth: async () => true }));
    vi.doMock("@/lib/localDb.js", () => ({
      getRoutingFilters: async () => [],
      getRoutingControls: async () => ({
        minTrustScore: 70, maxCostPer1k: null, maxLatencyMs: null,
        allowedCountries: [], blockedCountries: [], allowedIpRanges: [],
        blockedIpRanges: [], defaultAction: "allow",
      }),
      getPeerMetadata: async () => null,
    }));
    vi.doMock("@/lib/trustScore.js", () => ({ getTrustScore: async () => null }));

    const { POST } = await import("../../src/app/api/mesh/peers/filtered/route.js");
    const res = await POST(
      new Request("http://127.0.0.1/api/mesh/peers/filtered", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ peers: [{ id: "remote-peer-1" }] }),
      })
    );
    const j = await res.json();

    expect(res.status).toBe(200);
    expect(j.allowed).toHaveLength(0);
    expect(j.blocked).toHaveLength(1);
    expect(j.blocked[0].reason).toContain("unknown");
    // No digit may stand in for the peer's score; only the operator's own
    // threshold may appear.
    expect(j.blocked[0].reason.replace("70", "")).not.toMatch(/\d/);

    vi.doUnmock("@/lib/auth/middleware.js");
    vi.doUnmock("@/lib/localDb.js");
    vi.doUnmock("@/lib/trustScore.js");
    vi.resetModules();
  });

  it("admits an unscored peer when no threshold is configured", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/middleware.js", () => ({ checkAuth: async () => true }));
    vi.doMock("@/lib/localDb.js", () => ({
      getRoutingFilters: async () => [],
      getRoutingControls: async () => ({
        minTrustScore: null, maxCostPer1k: null, maxLatencyMs: null,
        allowedCountries: [], blockedCountries: [], allowedIpRanges: [],
        blockedIpRanges: [], defaultAction: "allow",
      }),
      getPeerMetadata: async () => null,
    }));
    vi.doMock("@/lib/trustScore.js", () => ({ getTrustScore: async () => null }));

    const { POST } = await import("../../src/app/api/mesh/peers/filtered/route.js");
    const res = await POST(
      new Request("http://127.0.0.1/api/mesh/peers/filtered", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ peers: [{ id: "remote-peer-1" }] }),
      })
    );
    const j = await res.json();
    expect(j.allowed).toHaveLength(1);
    expect(j.blocked).toHaveLength(0);

    vi.doUnmock("@/lib/auth/middleware.js");
    vi.doUnmock("@/lib/localDb.js");
    vi.doUnmock("@/lib/trustScore.js");
    vi.resetModules();
  });
});
