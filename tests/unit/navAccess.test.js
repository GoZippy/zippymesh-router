/**
 * Unit tests for the PURE sidebar nav-gating helpers
 * (src/lib/auth/navAccess.js, Sprint 5 task admin-dashboard-ui).
 *
 * These helpers map a user-account role -> UI visibility. They are pure (no
 * React, no I/O, no browser globals), so no mocking is needed. The rule under
 * test mirrors PORT_AND_ADMIN_SYSTEM_PLAN §3a/3b:
 *
 *   - "Admin" nav entry: visible to admin and superadmin (admin+).
 *   - "Shutdown" control: visible to superadmin ONLY.
 *   - user / viewer / unknown / null roles: see NEITHER (fail-closed).
 *
 * The UI gate is convenience only; real enforcement is server-side. These tests
 * pin the fail-closed posture so a missing/unknown role never leaks a control.
 */
import { describe, it, expect } from "vitest";
import { canSeeAdmin, canSeeShutdown, filterNavByRole } from "../../src/lib/auth/navAccess.js";

describe("canSeeAdmin() — Admin nav entry (admin+)", () => {
  it("superadmin and admin can see Admin", () => {
    expect(canSeeAdmin("superadmin")).toBe(true);
    expect(canSeeAdmin("admin")).toBe(true);
  });

  it("user and viewer cannot see Admin", () => {
    expect(canSeeAdmin("user")).toBe(false);
    expect(canSeeAdmin("viewer")).toBe(false);
  });

  it("fails closed on unknown / null / undefined roles", () => {
    expect(canSeeAdmin("wizard")).toBe(false);
    expect(canSeeAdmin(null)).toBe(false);
    expect(canSeeAdmin(undefined)).toBe(false);
    expect(canSeeAdmin("")).toBe(false);
  });
});

describe("canSeeShutdown() — Shutdown control (superadmin only)", () => {
  it("only superadmin can see Shutdown", () => {
    expect(canSeeShutdown("superadmin")).toBe(true);
  });

  it("admin, user, viewer cannot see Shutdown", () => {
    expect(canSeeShutdown("admin")).toBe(false);
    expect(canSeeShutdown("user")).toBe(false);
    expect(canSeeShutdown("viewer")).toBe(false);
  });

  it("fails closed on unknown / null / undefined roles", () => {
    expect(canSeeShutdown("wizard")).toBe(false);
    expect(canSeeShutdown(null)).toBe(false);
    expect(canSeeShutdown(undefined)).toBe(false);
  });
});

describe("matrix: who sees Admin vs Shutdown", () => {
  const expected = {
    superadmin: { admin: true, shutdown: true },
    admin: { admin: true, shutdown: false },
    user: { admin: false, shutdown: false },
    viewer: { admin: false, shutdown: false },
    unknown: { admin: false, shutdown: false },
    null: { admin: false, shutdown: false },
  };

  for (const [roleKey, want] of Object.entries(expected)) {
    it(`role=${roleKey}: admin=${want.admin}, shutdown=${want.shutdown}`, () => {
      const role = roleKey === "null" ? null : roleKey === "unknown" ? "wizard" : roleKey;
      expect(canSeeAdmin(role)).toBe(want.admin);
      expect(canSeeShutdown(role)).toBe(want.shutdown);
    });
  }
});

describe("filterNavByRole() — generic minRole filtering", () => {
  const items = [
    { href: "/dashboard", label: "Dashboard" }, // unrestricted
    { href: "/dashboard/admin", label: "Admin", minRole: "admin" },
    { href: "/dashboard/root", label: "Root", minRole: "superadmin" },
  ];

  it("unrestricted items always pass through", () => {
    const out = filterNavByRole(items, "viewer");
    expect(out.map((i) => i.href)).toEqual(["/dashboard"]);
  });

  it("admin sees unrestricted + admin-gated, not superadmin-gated", () => {
    const out = filterNavByRole(items, "admin");
    expect(out.map((i) => i.href)).toEqual(["/dashboard", "/dashboard/admin"]);
  });

  it("superadmin sees everything", () => {
    const out = filterNavByRole(items, "superadmin");
    expect(out.map((i) => i.href)).toEqual(["/dashboard", "/dashboard/admin", "/dashboard/root"]);
  });

  it("unknown / null role sees only unrestricted (fail-closed)", () => {
    expect(filterNavByRole(items, null).map((i) => i.href)).toEqual(["/dashboard"]);
    expect(filterNavByRole(items, "wizard").map((i) => i.href)).toEqual(["/dashboard"]);
  });

  it("does not mutate the input and tolerates non-arrays", () => {
    const copy = JSON.parse(JSON.stringify(items));
    filterNavByRole(items, "superadmin");
    expect(items).toEqual(copy);
    expect(filterNavByRole(null, "superadmin")).toEqual([]);
    expect(filterNavByRole(undefined, "superadmin")).toEqual([]);
  });
});
