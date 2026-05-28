/**
 * Unit tests for MeshSignatureBadge config helpers.
 *
 * The vitest config runs in a Node environment with no DOM, so we exercise the
 * pure helpers (resolveMeshSignatureConfig + the static config maps) rather
 * than rendering the React component. The component itself is a thin wrapper
 * around the existing Badge — its rendering is exercised in dev/Storybook.
 */
import { describe, it, expect } from "vitest";
import {
  MESH_SIGNATURE_STATUS_CONFIG,
  MESH_SIGNATURE_PRIORITY,
  resolveMeshSignatureConfig,
} from "../../src/shared/components/meshSignatureConfig.js";

describe("MeshSignatureBadge / status config", () => {
  it("defines all four documented statuses", () => {
    expect(Object.keys(MESH_SIGNATURE_STATUS_CONFIG).sort()).toEqual(
      ["error", "invalid", "missing", "valid"],
    );
  });

  it("maps each status to a Badge variant in the existing palette", () => {
    expect(MESH_SIGNATURE_STATUS_CONFIG.valid.variant).toBe("success");
    expect(MESH_SIGNATURE_STATUS_CONFIG.invalid.variant).toBe("error");
    expect(MESH_SIGNATURE_STATUS_CONFIG.missing.variant).toBe("warning");
    expect(MESH_SIGNATURE_STATUS_CONFIG.error.variant).toBe("warning");
  });

  it("uses the documented label text for each state", () => {
    expect(MESH_SIGNATURE_STATUS_CONFIG.valid.label).toBe("Verified");
    expect(MESH_SIGNATURE_STATUS_CONFIG.invalid.label).toBe("TAMPERED");
    expect(MESH_SIGNATURE_STATUS_CONFIG.missing.label).toBe("Unsigned");
    expect(MESH_SIGNATURE_STATUS_CONFIG.error.label).toBe("Verify error");
  });

  it("provides a non-empty default tooltip for every state", () => {
    for (const cfg of Object.values(MESH_SIGNATURE_STATUS_CONFIG)) {
      expect(typeof cfg.defaultTooltip).toBe("string");
      expect(cfg.defaultTooltip.length).toBeGreaterThan(0);
    }
  });

  it("orders priority so the most security-relevant verdict wins", () => {
    expect(MESH_SIGNATURE_PRIORITY).toEqual([
      "invalid",
      "error",
      "valid",
      "missing",
    ]);
    // invalid must precede every other state (T11 spec)
    expect(MESH_SIGNATURE_PRIORITY.indexOf("invalid")).toBe(0);
    // missing is least urgent
    expect(MESH_SIGNATURE_PRIORITY.indexOf("missing")).toBe(
      MESH_SIGNATURE_PRIORITY.length - 1,
    );
  });
});

describe("MeshSignatureBadge / resolveMeshSignatureConfig", () => {
  it("returns null for empty / missing status (no badge rendered)", () => {
    expect(resolveMeshSignatureConfig(undefined)).toBeNull();
    expect(resolveMeshSignatureConfig(null)).toBeNull();
    expect(resolveMeshSignatureConfig("")).toBeNull();
  });

  it("returns the matching config object for known statuses", () => {
    expect(resolveMeshSignatureConfig("valid")).toBe(
      MESH_SIGNATURE_STATUS_CONFIG.valid,
    );
    expect(resolveMeshSignatureConfig("invalid")).toBe(
      MESH_SIGNATURE_STATUS_CONFIG.invalid,
    );
    expect(resolveMeshSignatureConfig("missing")).toBe(
      MESH_SIGNATURE_STATUS_CONFIG.missing,
    );
    expect(resolveMeshSignatureConfig("error")).toBe(
      MESH_SIGNATURE_STATUS_CONFIG.error,
    );
  });

  it("falls back to the error config for unknown statuses", () => {
    // Defensive: if the sidecar ever invents a new status string we still
    // surface SOMETHING to the user rather than silently dropping it.
    expect(resolveMeshSignatureConfig("bogus")).toBe(
      MESH_SIGNATURE_STATUS_CONFIG.error,
    );
    expect(resolveMeshSignatureConfig("VALID" /* wrong case */)).toBe(
      MESH_SIGNATURE_STATUS_CONFIG.error,
    );
  });
});
