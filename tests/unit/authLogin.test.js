/**
 * Unit tests for the extended login flow in src/lib/auth/login.js.
 *
 * Isolation: localDb resolves its data directory from process.env.DATA_DIR at
 * module-load time. We point DATA_DIR at a fresh temp directory and dynamically
 * import the auth + db modules AFTER the env vars are set, mirroring
 * tests/unit/usersTable.test.js exactly so we never touch real data.
 *
 * We exercise the pure auth helpers (authenticate / seedSuperadminIfNeeded /
 * signAuthToken) directly — NOT isAuthenticated() / the route — so no Next.js
 * request context (cookies()) is required. JWTs are verified with `jose` using
 * the same HS256 secret the signer uses, proving cross-compatibility with the
 * middleware verifier.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { jwtVerify } from "jose";

// Unique temp data dir for this run (set BEFORE importing localDb/login).
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zippymesh-authlogin-test-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.ZIPPY_APP_NAME = "zippy-mesh-authlogin-test";
// A strong (>=32 char) secret so the auth layer signs/verifies consistently.
process.env.JWT_SECRET = "test-jwt-secret-that-is-definitely-long-enough-0123456789";

const DB_FILE = path.join(TEST_DATA_DIR, "db.json");
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

let localDb;
let auth;

/** Reset the on-disk db to a clean shape (no users) between tests. */
function writeFreshDb(extraSettings = {}) {
  const data = {
    providerConnections: [],
    providerNodes: [],
    modelAliases: {},
    combos: [],
    apiKeys: [],
    users: [],
    settings: { firstRun: false, ...extraSettings },
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

async function reloadDbFromDisk() {
  // Force the cached lowdb singleton to re-read the file we just wrote.
  const db = await localDb.getDb();
  await db.read();
}

beforeAll(async () => {
  localDb = await import("../../src/lib/localDb.js");
  auth = await import("../../src/lib/auth/login.js");
});

afterAll(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

beforeEach(async () => {
  // Clear seed-related env between tests so each case controls its own state.
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.SUPERADMIN_PASSWORD;
  delete process.env.INITIAL_PASSWORD;
});

describe("authenticate() — legacy single-password (no users)", () => {
  it("succeeds with a password-only body and yields a valid auth_token", async () => {
    const plain = "legacy-owner-password";
    const hash = await bcrypt.hash(plain, 10);
    writeFreshDb({ password: hash });
    await reloadDbFromDisk();

    const users = await localDb.listUsers();
    expect(users.length).toBe(0); // precondition: legacy path active

    const result = await auth.authenticate({ password: plain });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("legacy");
    expect(typeof result.token).toBe("string");

    // Token verifies under the shared HS256 secret and carries authenticated:true
    const { payload } = await jwtVerify(result.token, SECRET);
    expect(payload.authenticated).toBe(true);
    // Legacy owner is treated as the superadmin of this local-first router.
    expect(payload.role).toBe("superadmin");
  });

  it("rejects a wrong legacy password", async () => {
    const hash = await bcrypt.hash("the-right-one", 10);
    writeFreshDb({ password: hash });
    await reloadDbFromDisk();

    const result = await auth.authenticate({ password: "the-wrong-one" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("signals setupRequired when no credentials exist anywhere", async () => {
    writeFreshDb(); // no settings.password, no INITIAL_PASSWORD
    await reloadDbFromDisk();

    const result = await auth.authenticate({ password: "anything" });
    expect(result.ok).toBe(false);
    expect(result.setupRequired).toBe(true);
  });
});

describe("authenticate() — username + password (users exist)", () => {
  it("logs in a created user; JWT carries userId + username + role", async () => {
    writeFreshDb();
    await reloadDbFromDisk();

    const password_hash = await bcrypt.hash("s3cret-pass", 10);
    const created = await localDb.createUser({
      username: "adminuser",
      password_hash,
      role: "admin",
      email: "admin@example.com",
    });

    const result = await auth.authenticate({
      username: "adminuser",
      password: "s3cret-pass",
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("user");

    const { payload } = await jwtVerify(result.token, SECRET);
    expect(payload.authenticated).toBe(true);
    expect(payload.userId).toBe(created.id);
    expect(payload.username).toBe("adminuser");
    expect(payload.role).toBe("admin");
  });

  it("rejects a wrong password for an existing user", async () => {
    writeFreshDb();
    await reloadDbFromDisk();
    const password_hash = await bcrypt.hash("correct-horse", 10);
    await localDb.createUser({ username: "bob", password_hash, role: "user" });

    const result = await auth.authenticate({ username: "bob", password: "battery-staple" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("rejects an inactive (deactivated) user even with the right password", async () => {
    writeFreshDb();
    await reloadDbFromDisk();
    const password_hash = await bcrypt.hash("still-correct", 10);
    const u = await localDb.createUser({ username: "carol", password_hash, role: "user" });
    await localDb.deactivateUser(u.id);

    const result = await auth.authenticate({ username: "carol", password: "still-correct" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("rejects an unknown username", async () => {
    writeFreshDb();
    await reloadDbFromDisk();
    await localDb.createUser({
      username: "someone",
      password_hash: await bcrypt.hash("pw", 10),
    });

    const result = await auth.authenticate({ username: "ghost", password: "pw" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });
});

describe("seedSuperadminIfNeeded() — env bootstrap", () => {
  it("seeds a superadmin from ADMIN_USERNAME/ADMIN_PASSWORD when users table is empty, idempotently", async () => {
    writeFreshDb();
    await reloadDbFromDisk();
    expect((await localDb.listUsers()).length).toBe(0);

    process.env.ADMIN_USERNAME = "root";
    process.env.ADMIN_PASSWORD = "bootstrap-pass-123";

    const seeded = await auth.seedSuperadminIfNeeded();
    expect(seeded).not.toBeNull();
    expect(seeded.username).toBe("root");
    expect(seeded.role).toBe("superadmin");
    // Password is hashed (not stored verbatim) and verifies via bcrypt.
    expect(seeded.password_hash).not.toBe("bootstrap-pass-123");
    expect(await bcrypt.compare("bootstrap-pass-123", seeded.password_hash)).toBe(true);

    // Idempotent: a second call is a no-op (no duplicate user).
    const again = await auth.seedSuperadminIfNeeded();
    expect(again).toBeNull();
    expect((await localDb.listUsers()).length).toBe(1);
  });

  it("does nothing when env vars are not set", async () => {
    writeFreshDb();
    await reloadDbFromDisk();
    const seeded = await auth.seedSuperadminIfNeeded();
    expect(seeded).toBeNull();
    expect((await localDb.listUsers()).length).toBe(0);
  });

  it("authenticate() seeds then logs in the env superadmin in one call", async () => {
    writeFreshDb();
    await reloadDbFromDisk();
    process.env.ADMIN_USERNAME = "envadmin";
    process.env.ADMIN_PASSWORD = "env-admin-pass-xyz";

    const result = await auth.authenticate({
      username: "envadmin",
      password: "env-admin-pass-xyz",
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("user");
    const { payload } = await jwtVerify(result.token, SECRET);
    expect(payload.role).toBe("superadmin");
    expect(payload.username).toBe("envadmin");
  });
});
