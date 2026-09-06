/**
 * Tests for the pure Labs feature catalog + gating helpers.
 */
import { describe, it, expect } from "vitest";
import {
  LABS_FEATURES,
  LABS_FEATURE_KEYS,
  DEFAULT_LABS_FLAGS,
  isLabsEnabled,
  labsKeyForHref,
  filterNavByLabs,
  normalizeLabsFlags,
} from "../../src/lib/labs/features.js";

describe("Labs catalog", () => {
  it("every feature has key/label/description/navHrefs and default flags are all OFF", () => {
    for (const f of LABS_FEATURES) {
      expect(typeof f.key).toBe("string");
      expect(typeof f.label).toBe("string");
      expect(typeof f.description).toBe("string");
      expect(Array.isArray(f.navHrefs)).toBe(true);
    }
    for (const k of LABS_FEATURE_KEYS) expect(DEFAULT_LABS_FLAGS[k]).toBe(false);
  });
});

describe("isLabsEnabled — fail-closed", () => {
  it("true only when the flag is strictly true", () => {
    expect(isLabsEnabled({ mesh: true }, "mesh")).toBe(true);
    expect(isLabsEnabled({ mesh: false }, "mesh")).toBe(false);
    expect(isLabsEnabled({ mesh: "true" }, "mesh")).toBe(false);
    expect(isLabsEnabled({}, "mesh")).toBe(false);
    expect(isLabsEnabled(null, "mesh")).toBe(false);
    expect(isLabsEnabled(undefined, "mesh")).toBe(false);
  });
});

describe("labsKeyForHref", () => {
  it("maps experimental routes to their key and ungated routes to null", () => {
    expect(labsKeyForHref("/dashboard/network")).toBe("mesh");
    expect(labsKeyForHref("/dashboard/wallet")).toBe("wallet");
    expect(labsKeyForHref("/dashboard/marketplace")).toBe("marketplace");
    expect(labsKeyForHref("/dashboard/usage")).toBeNull();
    expect(labsKeyForHref("/dashboard")).toBeNull();
  });
});

describe("filterNavByLabs", () => {
  const items = [
    { href: "/dashboard/usage" },
    { href: "/dashboard/network" },   // mesh
    { href: "/dashboard/wallet" },    // wallet
    { href: "/dashboard/providers" },
  ];

  it("hides experimental items when their flag is off, keeps ungated", () => {
    const out = filterNavByLabs(items, {});
    expect(out.map((i) => i.href)).toEqual(["/dashboard/usage", "/dashboard/providers"]);
  });

  it("reveals an experimental item when its flag is on", () => {
    const out = filterNavByLabs(items, { mesh: true });
    expect(out.map((i) => i.href)).toContain("/dashboard/network");
    expect(out.map((i) => i.href)).not.toContain("/dashboard/wallet");
  });

  it("does not mutate the input and tolerates junk", () => {
    const copy = [...items];
    filterNavByLabs(items, { mesh: true });
    expect(items).toEqual(copy);
    expect(filterNavByLabs(null, {})).toEqual([]);
    expect(filterNavByLabs([{ nope: 1 }], {})).toEqual([{ nope: 1 }]);
  });
});

describe("normalizeLabsFlags — only known keys, boolean-coerced", () => {
  it("keeps known keys as strict booleans and drops unknown keys", () => {
    const out = normalizeLabsFlags({ mesh: true, wallet: "yes", evil: true, __proto__: { x: 1 } });
    expect(out).toEqual({ mesh: true, wallet: false });
    expect("evil" in out).toBe(false);
  });
  it("returns {} for non-objects", () => {
    expect(normalizeLabsFlags(null)).toEqual({});
    expect(normalizeLabsFlags("x")).toEqual({});
  });
});
