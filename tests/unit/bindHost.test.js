/**
 * Unit tests for src/lib/net/bindHost.js — pure helpers that resolve the
 * server bind host (secure-by-default loopback) and detect dangerous LAN
 * exposure with login disabled.
 *
 * No network calls, no DB, no real environment variables required: every
 * helper is pure and takes its inputs as arguments.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_BIND_HOST,
  resolveBindHost,
  isLoopbackHost,
  isDangerousExposure,
  dangerousExposureWarning,
} from "../../src/lib/net/bindHost.js";

describe("DEFAULT_BIND_HOST", () => {
  it("is loopback (secure by default)", () => {
    expect(DEFAULT_BIND_HOST).toBe("127.0.0.1");
    expect(isLoopbackHost(DEFAULT_BIND_HOST)).toBe(true);
  });
});

describe("resolveBindHost — precedence", () => {
  it("defaults to 127.0.0.1 when nothing is set", () => {
    expect(resolveBindHost({})).toBe("127.0.0.1");
    expect(resolveBindHost(undefined)).toBe("127.0.0.1");
  });

  it("uses HOST when ZIPPY_BIND_HOST is unset", () => {
    expect(resolveBindHost({ HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });

  it("prefers ZIPPY_BIND_HOST over HOST", () => {
    expect(
      resolveBindHost({ ZIPPY_BIND_HOST: "192.168.1.5", HOST: "0.0.0.0" })
    ).toBe("192.168.1.5");
  });

  it("prefers ZIPPY_BIND_HOST even when it selects loopback", () => {
    expect(
      resolveBindHost({ ZIPPY_BIND_HOST: "127.0.0.1", HOST: "0.0.0.0" })
    ).toBe("127.0.0.1");
  });

  it("ignores empty / whitespace-only values (treated as unset)", () => {
    expect(resolveBindHost({ ZIPPY_BIND_HOST: "   ", HOST: "0.0.0.0" })).toBe("0.0.0.0");
    expect(resolveBindHost({ ZIPPY_BIND_HOST: "", HOST: "" })).toBe("127.0.0.1");
  });

  it("trims surrounding whitespace from the chosen value", () => {
    expect(resolveBindHost({ ZIPPY_BIND_HOST: "  0.0.0.0  " })).toBe("0.0.0.0");
  });
});

describe("isLoopbackHost", () => {
  it("is true for loopback spellings", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("  localhost  ")).toBe(true);
  });

  it("is false for non-loopback / LAN hosts", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.5")).toBe(false);
    expect(isLoopbackHost("172.16.0.7")).toBe(false);
    expect(isLoopbackHost("::")).toBe(false);
  });

  it("is false for non-string / empty input", () => {
    expect(isLoopbackHost(undefined)).toBe(false);
    expect(isLoopbackHost(null)).toBe(false);
    expect(isLoopbackHost("")).toBe(false);
    expect(isLoopbackHost(127)).toBe(false);
  });
});

describe("isDangerousExposure — matrix", () => {
  it("loopback + open (requireLogin false) => false", () => {
    expect(isDangerousExposure("127.0.0.1", false)).toBe(false);
    expect(isDangerousExposure("localhost", false)).toBe(false);
    expect(isDangerousExposure("::1", false)).toBe(false);
  });

  it("0.0.0.0 + open (requireLogin false) => true", () => {
    expect(isDangerousExposure("0.0.0.0", false)).toBe(true);
    expect(isDangerousExposure("192.168.1.5", false)).toBe(true);
  });

  it("0.0.0.0 + login required (requireLogin true) => false", () => {
    expect(isDangerousExposure("0.0.0.0", true)).toBe(false);
    expect(isDangerousExposure("192.168.1.5", true)).toBe(false);
  });

  it("never fires when requireLogin is unknown/undefined (no false alarm)", () => {
    expect(isDangerousExposure("0.0.0.0", undefined)).toBe(false);
    expect(isDangerousExposure("0.0.0.0", null)).toBe(false);
    // Only a strict `=== false` counts as open mode.
    expect(isDangerousExposure("0.0.0.0", 0)).toBe(false);
  });
});

describe("dangerousExposureWarning", () => {
  it("is multi-line and mentions the host, the disabled login, and the fixes", () => {
    const msg = dangerousExposureWarning("0.0.0.0");
    expect(msg).toContain("\n");
    expect(msg).toContain("0.0.0.0");
    expect(msg.toLowerCase()).toContain("security warning");
    expect(msg).toContain("requireLogin");
    expect(msg).toContain("127.0.0.1");
    expect(msg).toContain("ZIPPY_BIND_HOST");
  });

  it("falls back to a sensible host label for blank/non-string input", () => {
    expect(dangerousExposureWarning("")).toContain("0.0.0.0");
    expect(dangerousExposureWarning(undefined)).toContain("0.0.0.0");
  });
});
