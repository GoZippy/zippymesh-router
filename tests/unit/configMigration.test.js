/**
 * Version-update safety: an OLD db.json (from a prior release, missing newer
 * keys) must upgrade cleanly when loaded — existing user data PRESERVED, new
 * keys ADDED with safe defaults, and setup NOT re-triggered. This is the
 * "new versions don't break existing installs" guarantee (localDb.ensureDbShape).
 *
 * DATA_DIR is set to a throwaway temp dir BEFORE importing localDb (it reads the
 * dir at module load), seeded with a minimal legacy db.json.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zippymesh-migrate-test-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.ZIPPY_APP_NAME = "zippy-mesh-migrate-test";

// A minimal "old version" DB: real user data, but missing users/experimental/
// playbooks/pools and several settings that newer versions expect.
const LEGACY_DB = {
  settings: {
    password: "$2a$10$legacybcrypthashvalue000000000000000000000000000000000",
    requireLogin: true,
    stickyRoundRobinLimit: 7, // a non-default value that MUST be preserved
  },
  providerConnections: [
    { id: "conn-legacy", provider: "openai", name: "My OpenAI", apiKey: "sk-legacy" },
  ],
  combos: [{ id: "combo-legacy", name: "fallback", models: ["a", "b"] }],
  apiKeys: [{ id: "key-legacy", name: "cli" }],
};

let localDb;

beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret-migrate";
  fs.writeFileSync(path.join(TEST_DATA_DIR, "db.json"), JSON.stringify(LEGACY_DB, null, 2));
  localDb = await import("../../src/lib/localDb.js");
});

afterAll(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("legacy db.json upgrade is non-destructive", () => {
  it("PRESERVES existing user data", async () => {
    const db = await localDb.getDb();
    expect(db.data.settings.password).toBe(LEGACY_DB.settings.password);
    expect(db.data.settings.requireLogin).toBe(true);
    expect(db.data.settings.stickyRoundRobinLimit).toBe(7); // non-default kept
    expect(db.data.providerConnections.find((c) => c.id === "conn-legacy")).toBeTruthy();
    expect(db.data.providerConnections[0].apiKey).toBe("sk-legacy");
    expect(db.data.combos.find((c) => c.id === "combo-legacy")).toBeTruthy();
    expect(db.data.apiKeys.find((k) => k.id === "key-legacy")).toBeTruthy();
  });

  it("ADDS newer top-level keys with safe defaults", async () => {
    const db = await localDb.getDb();
    expect(Array.isArray(db.data.users)).toBe(true); // added by Sprint-1 default
    expect(Array.isArray(db.data.routingPlaybooks)).toBe(true);
    expect(db.data.routingPlaybooks.length).toBeGreaterThan(0); // default playbooks seeded
    expect(Array.isArray(db.data.p2pOffers)).toBe(true);
    expect(Array.isArray(db.data.routingPools)).toBe(true);
    expect(db.data.nodePricingConfig && typeof db.data.nodePricingConfig).toBe("object");
  });

  it("does NOT re-trigger first-run setup on an existing install", async () => {
    const db = await localDb.getDb();
    expect(db.data.settings.firstRun).toBe(false);
  });

  it("persists the repaired shape back to disk (migration is durable)", async () => {
    await localDb.getDb();
    const onDisk = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, "db.json"), "utf8"));
    expect(onDisk.settings.password).toBe(LEGACY_DB.settings.password); // not clobbered
    expect(Array.isArray(onDisk.users)).toBe(true); // new key written through
  });
});
