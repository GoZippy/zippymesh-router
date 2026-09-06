/**
 * Unit tests for the admin user-management REST API
 * (src/app/api/admin/users/route.js and .../[id]/route.js).
 *
 * Strategy:
 *   - We exercise the route handlers DIRECTLY (import the GET/POST/PATCH/DELETE
 *     exports and call them) rather than going through an HTTP server.
 *   - The auth middleware is mocked: requireRole() becomes a passthrough (it has
 *     already been unit-tested elsewhere and depends on next/headers + settings),
 *     and getSessionClaims() is driven by a mutable `currentClaims` holder so each
 *     test can act as a specific user. This isolates the ROUTE's own authz logic
 *     (canAssignRole gating, self-upgrade / self-deactivate guards, password
 *     hashing, password_hash stripping) — the behaviour this task owns.
 *   - localDb runs FOR REAL against a throwaway temp DATA_DIR (the same isolation
 *     seam used by tests/unit/usersTable.test.js), so we verify the real stored
 *     records (e.g. that the persisted hash != plaintext).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import bcrypt from "bcryptjs";

// Temp data dir + app name MUST be set before localDb is imported (it reads
// DATA_DIR at module-load time).
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zippymesh-adminusers-test-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.ZIPPY_APP_NAME = "zippy-mesh-adminusers-test";

// Mutable session holder shared with the middleware mock. Hoisted so it exists
// before vi.mock's factory (which is hoisted to the top of the module) runs.
const authState = vi.hoisted(() => ({ claims: null }));

// Mock the auth middleware: requireRole -> passthrough wrapper, getSessionClaims
// -> returns whatever the current test configured. This is the ONLY mock; the
// rbac helpers and localDb are the real implementations.
vi.mock("@/lib/auth/middleware.js", () => ({
  requireRole: (_minRole, handler) => handler,
  requireSuperadmin: (handler) => handler,
  getSessionClaims: async () => authState.claims,
}));

let localDb;
let collectionRoute;
let itemRoute;

/** Build a minimal Request-like object carrying a JSON body. */
function makeRequest(body) {
  return {
    headers: { get: () => null },
    json: async () => body,
  };
}

/** Act as a given user for the duration of the next handler call. */
function actAs(claims) {
  authState.claims = claims;
}

async function readJson(res) {
  // Route handlers return NextResponse / Response; both expose .json() + .status.
  const data = await res.json();
  return { status: res.status, data };
}

beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret-admin-users";
  localDb = await import("../../src/lib/localDb.js");
  collectionRoute = await import("../../src/app/api/admin/users/route.js");
  itemRoute = await import("../../src/app/api/admin/users/[id]/route.js");
});

afterAll(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

beforeEach(() => {
  authState.claims = null;
});

describe("POST /api/admin/users — creation + role-assignment gating", () => {
  it("admin can create a viewer; response has no password_hash and stored hash != plaintext", async () => {
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });
    const res = await collectionRoute.POST(
      makeRequest({ username: "vquser", password: "s3cret-pass", role: "viewer", email: "v@x.io" })
    );
    const { status, data } = await readJson(res);

    expect(status).toBe(201);
    expect(data.user).toBeTruthy();
    expect(data.user.username).toBe("vquser");
    expect(data.user.role).toBe("viewer");
    // password_hash never leaves the API
    expect(data.user.password_hash).toBeUndefined();
    expect(data.user.password).toBeUndefined();

    // Stored record holds a bcrypt hash, NOT the plaintext.
    const stored = await localDb.getUserByUsername("vquser");
    expect(stored.password_hash).toBeTruthy();
    expect(stored.password_hash).not.toBe("s3cret-pass");
    expect(await bcrypt.compare("s3cret-pass", stored.password_hash)).toBe(true);
  });

  it("admin can create a 'user' role", async () => {
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });
    const res = await collectionRoute.POST(
      makeRequest({ username: "plainuser", password: "pw12345", role: "user" })
    );
    const { status, data } = await readJson(res);
    expect(status).toBe(201);
    expect(data.user.role).toBe("user");
  });

  it("admin CANNOT create an admin (403)", async () => {
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });
    const res = await collectionRoute.POST(
      makeRequest({ username: "wannabeadmin", password: "pw12345", role: "admin" })
    );
    const { status } = await readJson(res);
    expect(status).toBe(403);
    // Nothing persisted.
    expect(await localDb.getUserByUsername("wannabeadmin")).toBeNull();
  });

  it("admin CANNOT create a superadmin (403)", async () => {
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });
    const res = await collectionRoute.POST(
      makeRequest({ username: "wannabesuper", password: "pw12345", role: "superadmin" })
    );
    const { status } = await readJson(res);
    expect(status).toBe(403);
    expect(await localDb.getUserByUsername("wannabesuper")).toBeNull();
  });

  it("superadmin CAN create an admin", async () => {
    actAs({ authenticated: true, userId: "super-1", username: "root", role: "superadmin" });
    const res = await collectionRoute.POST(
      makeRequest({ username: "newadmin", password: "pw12345", role: "admin" })
    );
    const { status, data } = await readJson(res);
    expect(status).toBe(201);
    expect(data.user.role).toBe("admin");
  });

  it("rejects a duplicate username with 409", async () => {
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });
    await collectionRoute.POST(makeRequest({ username: "dupe", password: "pw12345", role: "viewer" }));
    const res = await collectionRoute.POST(
      makeRequest({ username: "dupe", password: "pw12345", role: "viewer" })
    );
    const { status } = await readJson(res);
    expect(status).toBe(409);
  });

  it("requires username and password (400)", async () => {
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });
    const noName = await readJson(await collectionRoute.POST(makeRequest({ password: "pw12345" })));
    expect(noName.status).toBe(400);
    const noPw = await readJson(await collectionRoute.POST(makeRequest({ username: "nopw" })));
    expect(noPw.status).toBe(400);
  });

  it("ignores a caller-supplied password_hash (no direct hash injection)", async () => {
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });
    const res = await collectionRoute.POST(
      makeRequest({
        username: "injuser",
        password: "realpass",
        role: "viewer",
        password_hash: "$2a$10$attackerControlledHashValueHere000000000000000000000000",
      })
    );
    const { status } = await readJson(res);
    expect(status).toBe(201);
    const stored = await localDb.getUserByUsername("injuser");
    // The stored hash must be derived from the plaintext, NOT the injected value.
    expect(await bcrypt.compare("realpass", stored.password_hash)).toBe(true);
  });
});

describe("GET /api/admin/users — listing strips password_hash", () => {
  it("returns users without any password_hash field", async () => {
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });
    const res = await collectionRoute.GET(makeRequest());
    const { status, data } = await readJson(res);
    expect(status).toBe(200);
    expect(Array.isArray(data.users)).toBe(true);
    expect(data.users.length).toBeGreaterThan(0);
    for (const u of data.users) {
      expect(u.password_hash).toBeUndefined();
      expect(u.password).toBeUndefined();
    }
  });
});

describe("PATCH /api/admin/users/:id — update + escalation guards", () => {
  it("blocks self role-upgrade (admin upgrading own account) with 403", async () => {
    // Create the self target (a 'user' record we will act as).
    const self = await localDb.createUser({
      username: "selfupgrade",
      password_hash: "x",
      role: "user",
    });
    actAs({ authenticated: true, userId: self.id, username: self.username, role: "admin" });

    const res = await itemRoute.PATCH(makeRequest({ role: "superadmin" }), {
      params: Promise.resolve({ id: self.id }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(403);

    const after = await localDb.getUserById(self.id);
    expect(after.role).toBe("user"); // unchanged
  });

  it("blocks an admin upgrading another user to admin (canAssignRole) with 403", async () => {
    const victim = await localDb.createUser({
      username: "victim-upgrade",
      password_hash: "x",
      role: "user",
    });
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });

    const res = await itemRoute.PATCH(makeRequest({ role: "admin" }), {
      params: Promise.resolve({ id: victim.id }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(403);
    expect((await localDb.getUserById(victim.id)).role).toBe("user");
  });

  it("hashes a changed password and strips password_hash from the response", async () => {
    const u = await localDb.createUser({
      username: "pwchange",
      password_hash: "old",
      role: "user",
    });
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });

    const res = await itemRoute.PATCH(makeRequest({ password: "brand-new-pw" }), {
      params: Promise.resolve({ id: u.id }),
    });
    const { status, data } = await readJson(res);
    expect(status).toBe(200);
    expect(data.user.password_hash).toBeUndefined();

    const stored = await localDb.getUserById(u.id);
    expect(stored.password_hash).not.toBe("brand-new-pw");
    expect(await bcrypt.compare("brand-new-pw", stored.password_hash)).toBe(true);
  });

  it("returns 404 for an unknown user id", async () => {
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });
    const res = await itemRoute.PATCH(makeRequest({ email: "x@y.io" }), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect((await readJson(res)).status).toBe(404);
  });
});

describe("DELETE /api/admin/users/:id — deactivate guards", () => {
  it("blocks deactivating your own account (lockout guard) with 403", async () => {
    const self = await localDb.createUser({
      username: "selfdeactivate",
      password_hash: "x",
      role: "admin",
    });
    actAs({ authenticated: true, userId: self.id, username: self.username, role: "admin" });

    const res = await itemRoute.DELETE(makeRequest(), {
      params: Promise.resolve({ id: self.id }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(403);
    expect((await localDb.getUserById(self.id)).is_active).toBe(true); // still active
  });

  it("blocks an admin from deactivating an admin target (403); only superadmin may", async () => {
    const otherAdmin = await localDb.createUser({
      username: "other-admin",
      password_hash: "x",
      role: "admin",
    });
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });

    const res = await itemRoute.DELETE(makeRequest(), {
      params: Promise.resolve({ id: otherAdmin.id }),
    });
    expect((await readJson(res)).status).toBe(403);
    expect((await localDb.getUserById(otherAdmin.id)).is_active).toBe(true);
  });

  it("admin CAN deactivate a viewer; response strips password_hash", async () => {
    const viewer = await localDb.createUser({
      username: "deactme",
      password_hash: "x",
      role: "viewer",
    });
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });

    const res = await itemRoute.DELETE(makeRequest(), {
      params: Promise.resolve({ id: viewer.id }),
    });
    const { status, data } = await readJson(res);
    expect(status).toBe(200);
    expect(data.user.password_hash).toBeUndefined();
    expect(data.user.is_active).toBe(false);
    expect((await localDb.getUserById(viewer.id)).is_active).toBe(false);
  });

  it("superadmin CAN deactivate an admin", async () => {
    const adminTarget = await localDb.createUser({
      username: "super-can-kill",
      password_hash: "x",
      role: "admin",
    });
    actAs({ authenticated: true, userId: "super-1", username: "root", role: "superadmin" });

    const res = await itemRoute.DELETE(makeRequest(), {
      params: Promise.resolve({ id: adminTarget.id }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(200);
    expect((await localDb.getUserById(adminTarget.id)).is_active).toBe(false);
  });
});

describe("PATCH is_active — (de)activation privilege guards (security fix)", () => {
  it("admin CANNOT reactivate a deactivated admin via PATCH is_active=true (403)", async () => {
    const deadAdmin = await localDb.createUser({
      username: "patch-reactivate-admin",
      password_hash: "x",
      role: "admin",
    });
    await localDb.deactivateUser(deadAdmin.id); // is_active=false
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });

    const res = await itemRoute.PATCH(makeRequest({ is_active: true }), {
      params: Promise.resolve({ id: deadAdmin.id }),
    });
    expect((await readJson(res)).status).toBe(403);
    expect((await localDb.getUserById(deadAdmin.id)).is_active).toBe(false); // still disabled
  });

  it("superadmin CAN reactivate a deactivated admin via PATCH is_active=true (200)", async () => {
    const deadAdmin2 = await localDb.createUser({
      username: "patch-reactivate-admin-2",
      password_hash: "x",
      role: "admin",
    });
    await localDb.deactivateUser(deadAdmin2.id);
    actAs({ authenticated: true, userId: "super-1", username: "root", role: "superadmin" });

    const res = await itemRoute.PATCH(makeRequest({ is_active: true }), {
      params: Promise.resolve({ id: deadAdmin2.id }),
    });
    expect((await readJson(res)).status).toBe(200);
    expect((await localDb.getUserById(deadAdmin2.id)).is_active).toBe(true);
  });

  it("blocks deactivating your OWN account via PATCH is_active=false (lockout) with 403", async () => {
    const selfPatch = await localDb.createUser({
      username: "patch-self-lockout",
      password_hash: "x",
      role: "admin",
    });
    actAs({ authenticated: true, userId: selfPatch.id, username: selfPatch.username, role: "admin" });

    const res = await itemRoute.PATCH(makeRequest({ is_active: false }), {
      params: Promise.resolve({ id: selfPatch.id }),
    });
    expect((await readJson(res)).status).toBe(403);
    expect((await localDb.getUserById(selfPatch.id)).is_active).toBe(true); // still active
  });

  it("admin CAN toggle is_active on a viewer (normal path still works)", async () => {
    const viewer2 = await localDb.createUser({
      username: "patch-viewer-active",
      password_hash: "x",
      role: "viewer",
    });
    actAs({ authenticated: true, userId: "admin-1", username: "adm", role: "admin" });

    const res = await itemRoute.PATCH(makeRequest({ is_active: false }), {
      params: Promise.resolve({ id: viewer2.id }),
    });
    expect((await readJson(res)).status).toBe(200);
    expect((await localDb.getUserById(viewer2.id)).is_active).toBe(false);
  });
});
