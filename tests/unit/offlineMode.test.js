import { describe, it, expect } from "vitest";
import { isOfflineMode } from "../../src/lib/privacy/offlineMode.js";

describe("isOfflineMode — privacy kill-switch", () => {
  it("defaults to false (no env, no settings)", () => {
    expect(isOfflineMode({}, null)).toBe(false);
    expect(isOfflineMode({}, {})).toBe(false);
  });

  it("is true for truthy ZIPPY_OFFLINE env values (case/space-insensitive)", () => {
    for (const v of ["true", "1", "yes", "on", " TRUE ", "On"]) {
      expect(isOfflineMode({ ZIPPY_OFFLINE: v }, null)).toBe(true);
    }
  });

  it("is false for falsey/garbage env values", () => {
    for (const v of ["false", "0", "no", "off", "", "maybe"]) {
      expect(isOfflineMode({ ZIPPY_OFFLINE: v }, null)).toBe(false);
    }
  });

  it("is true when settings.offlineMode === true (strict)", () => {
    expect(isOfflineMode({}, { offlineMode: true })).toBe(true);
    expect(isOfflineMode({}, { offlineMode: "true" })).toBe(false);
    expect(isOfflineMode({}, { offlineMode: false })).toBe(false);
  });

  it("env OR settings can enable it", () => {
    expect(isOfflineMode({ ZIPPY_OFFLINE: "1" }, { offlineMode: false })).toBe(true);
    expect(isOfflineMode({ ZIPPY_OFFLINE: "no" }, { offlineMode: true })).toBe(true);
  });
});
