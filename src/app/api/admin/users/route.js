/**
 * Admin user-management collection endpoint.
 *
 *   GET  /api/admin/users  -> list users (admin+). Never returns password_hash.
 *   POST /api/admin/users  -> create a user (admin+). Hashes the incoming
 *                             plaintext password before storage and enforces
 *                             role-assignment escalation rules.
 *
 * Authz model (per PORT_AND_ADMIN_SYSTEM_PLAN.md §3c):
 *   - Reading/creating users requires the `admin` user-account role or higher
 *     (admin | superadmin); requireRole() handles the 401/403 gate and the
 *     open-mode (requireLogin===false) superadmin treatment.
 *   - An admin may create ONLY non-privileged roles (user | viewer). Only a
 *     superadmin may create admin/superadmin accounts — enforced here with
 *     canAssignRole() so the route fails closed even though requireRole only
 *     checks the floor role.
 *
 * Password handling: createUser() in localDb stores `password_hash` VERBATIM, so
 * this route is responsible for bcrypt-hashing the plaintext `password` field
 * before persisting. A caller-supplied `password_hash` is NEVER trusted (we
 * delete it from the body) to prevent injecting a pre-chosen hash.
 */
import { NextResponse } from "next/server";
import { listUsers, createUser } from "@/lib/localDb.js";
import { apiError } from "@/lib/apiErrors.js";
import { requireRole, getSessionClaims } from "@/lib/auth/middleware.js";
import { canAssignRole, USER_ROLES } from "@/lib/auth/rbac.js";
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 10;

/**
 * Strip the password_hash (and any stray plaintext password) from a stored user
 * record before it leaves the API. Returns a shallow copy — the stored object is
 * never mutated.
 */
function sanitizeUser(user) {
  if (!user || typeof user !== "object") return user;
  const { password_hash, password, ...safe } = user;
  return safe;
}

/**
 * Resolve the acting session's role/identity inside a requireRole-gated handler.
 *
 * requireRole() does NOT pass the claims through to the handler and, in open
 * mode (requireLogin===false), grants access with no JWT at all. We therefore
 * re-read the claims here. In open mode getSessionClaims() returns null; we
 * model that as the superadmin owner with no userId, which is correct: the
 * legacy/open owner is the implicit superadmin, and a null userId can never
 * equal a target id so the self-* guards stay inert (as intended).
 */
async function resolveActor() {
  const claims = await getSessionClaims();
  if (!claims) {
    return { role: USER_ROLES.SUPERADMIN, userId: null, username: null };
  }
  return { role: claims.role, userId: claims.userId, username: claims.username };
}

async function listUsersHandler(request) {
  try {
    const users = await listUsers();
    return NextResponse.json({ users: users.map(sanitizeUser) });
  } catch (error) {
    console.log("Error listing users:", error);
    return apiError(request, 500, "Failed to list users");
  }
}

async function createUserHandler(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return apiError(request, 400, "Invalid JSON body");
  }
  if (!body || typeof body !== "object") {
    return apiError(request, 400, "Request body must be a JSON object");
  }

  // Never trust a caller-supplied hash — only a plaintext password is accepted.
  delete body.password_hash;

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  // Default new accounts to the least-privileged role when unspecified.
  const role = typeof body.role === "string" && body.role ? body.role : USER_ROLES.VIEWER;
  const email = typeof body.email === "string" ? body.email.trim() : undefined;

  if (!username) {
    return apiError(request, 400, "username is required");
  }
  if (!password) {
    return apiError(request, 400, "password is required");
  }

  // Escalation guard: the actor must be permitted to assign the requested role.
  // canAssignRole rejects unknown roles and blocks admins from minting
  // admin/superadmin accounts; only superadmin may assign privileged roles.
  const actor = await resolveActor();
  if (!canAssignRole(actor.role, role)) {
    return apiError(request, 403, `Forbidden: you may not assign the role "${role}"`);
  }

  let password_hash;
  try {
    password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  } catch (error) {
    console.log("Error hashing password:", error);
    return apiError(request, 500, "Failed to process password");
  }

  try {
    const user = await createUser({ username, password_hash, role, email });
    return NextResponse.json({ user: sanitizeUser(user) }, { status: 201 });
  } catch (error) {
    // createUser throws on duplicate username -> map to 409 Conflict.
    if (/already exists/i.test(error?.message || "")) {
      return apiError(request, 409, "A user with that username already exists");
    }
    if (/username is required/i.test(error?.message || "")) {
      return apiError(request, 400, "username is required");
    }
    console.log("Error creating user:", error);
    return apiError(request, 500, "Failed to create user");
  }
}

export const GET = requireRole(USER_ROLES.ADMIN, listUsersHandler);
export const POST = requireRole(USER_ROLES.ADMIN, createUserHandler);
