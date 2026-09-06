/**
 * Unit tests for the `users` entity in src/lib/localDb.js.
 *
 * Isolation: localDb resolves its data directory from process.env.DATA_DIR at
 * module-load time (see getUserDataDir()), and getDb() caches a module-level
 * singleton. To avoid clobbering real data we point DATA_DIR at a fresh temp
 * directory and dynamically import localDb AFTER the env var is set, so the
 * module reads the temp path. Each run gets its own unique directory.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Unique temp data dir for this test run (set BEFORE importing localDb).
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zippymesh-users-test-"));
process.env.DATA_DIR = TEST_DATA_DIR;
// Avoid the legacy-dir migration branch touching anything real.
process.env.ZIPPY_APP_NAME = "zippy-mesh-users-test";

const DB_FILE = path.join(TEST_DATA_DIR, "db.json");

// Dynamically import so DATA_DIR is honored.
let localDb;

beforeAll(async () => {
  localDb = await import("../../src/lib/localDb.js");
});

afterAll(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("users entity — CRUD lifecycle", () => {
  it("create -> getByUsername -> getById -> list -> update -> deactivate", async () => {
    const created = await localDb.createUser({
      username: "alice",
      password_hash: "hashed-pw-alice",
      email: "alice@example.com",
    });

    // Shape + defaults
    expect(created.id).toBeTruthy();
    expect(created.username).toBe("alice");
    expect(created.password_hash).toBe("hashed-pw-alice");
    expect(created.email).toBe("alice@example.com");
    expect(created.role).toBe("user"); // default role
    expect(created.is_active).toBe(true);
    expect(created.created_at).toBeTruthy();
    expect(created.updated_at).toBeTruthy();

    // getByUsername
    const byUsername = await localDb.getUserByUsername("alice");
    expect(byUsername).not.toBeNull();
    expect(byUsername.id).toBe(created.id);

    // getById
    const byId = await localDb.getUserById(created.id);
    expect(byId).not.toBeNull();
    expect(byId.username).toBe("alice");

    // list
    const list = await localDb.listUsers();
    expect(Array.isArray(list)).toBe(true);
    expect(list.some(u => u.id === created.id)).toBe(true);

    // update (role + email)
    const updated = await localDb.updateUser(created.id, {
      role: "admin",
      email: "alice2@example.com",
    });
    expect(updated.role).toBe("admin");
    expect(updated.email).toBe("alice2@example.com");
    expect(updated.username).toBe("alice"); // unchanged

    // deactivate (soft-delete)
    const deactivated = await localDb.deactivateUser(created.id);
    expect(deactivated.is_active).toBe(false);

    // Still retrievable (soft-delete, not hard-delete)
    const afterDeactivate = await localDb.getUserById(created.id);
    expect(afterDeactivate).not.toBeNull();
    expect(afterDeactivate.is_active).toBe(false);
  });

  it("defaults an invalid/unknown role to 'user'", async () => {
    const u = await localDb.createUser({ username: "roletest", role: "wizard" });
    expect(u.role).toBe("user");
  });

  it("accepts a valid role from the allowed set", async () => {
    const u = await localDb.createUser({ username: "viewer1", role: "viewer" });
    expect(u.role).toBe("viewer");
  });
});

describe("users entity — unique username", () => {
  it("rejects creating a second user with an existing username", async () => {
    await localDb.createUser({ username: "dup", password_hash: "h1" });
    await expect(
      localDb.createUser({ username: "dup", password_hash: "h2" })
    ).rejects.toThrow(/already exists/i);
  });

  it("requires a username", async () => {
    await expect(localDb.createUser({ password_hash: "x" })).rejects.toThrow(/username is required/i);
  });
});

describe("users entity — migration / repair", () => {
  it("repairs a db.json missing the `users` key to users: []", async () => {
    // Write a legacy db.json WITHOUT a `users` key directly to disk.
    const legacy = {
      providerConnections: [],
      providerNodes: [],
      modelAliases: {},
      combos: [],
      apiKeys: [],
      settings: { firstRun: false, password: "legacy-single-password" },
    };
    expect(legacy.users).toBeUndefined();
    fs.writeFileSync(DB_FILE, JSON.stringify(legacy, null, 2), "utf8");

    // Force the singleton to re-read from disk and run ensureDbShape().
    const db = await localDb.getDb();
    await db.read();
    // Re-trigger the migration path by calling getDb again (it re-reads + repairs).
    const repaired = await localDb.getDb();

    expect(Array.isArray(repaired.data.users)).toBe(true);
    expect(repaired.data.users).toEqual([]);

    // Legacy single-password must remain untouched by the users migration.
    expect(repaired.data.settings.password).toBe("legacy-single-password");
  });
});
