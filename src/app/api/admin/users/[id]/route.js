/**
 * Admin user-management item endpoint.
 *
 *   PATCH  /api/admin/users/:id  -> update a user (admin+).
 *   DELETE /api/admin/users/:id  -> soft-deactivate a user (admin+).
 *
 * Authz model (per PORT_AND_ADMIN_SYSTEM_PLAN.md §3c). requireRole('admin', ...)
 * sets the floor; the additional escalation/lockout guards below FAIL CLOSED:
 *
 *   PATCH:
 *     - If `role` changes, the actor must be allowed to assign it
 *       (canAssignRole): admins may not upgrade anyone to admin/superadmin.
 *     - No self role-UPGRADE: an actor changing their OWN account to a strictly
 *       higher role is rejected (privilege escalation), even for superadmin.
 *     - `password` (plaintext) is bcrypt-hashed; a caller-supplied
 *       `password_hash` is dropped (never injected directly).
 *     - `id`, `username` immutability and `created_at` are left to localDb.
 *
 *   DELETE (soft / deactivate):
 *     - Only a superadmin may deactivate an admin/superadmin target (admins may
 *       deactivate only user/viewer accounts) — modelled with canAssignRole on
 *       the TARGET's current role.
 *     - An actor may never deactivate their OWN account (lockout guard).
 *
 * Every response strips password_hash via sanitizeUser().
 */
import { NextResponse } from "next/server";
import { getUserById, updateUser, deactivateUser } from "@/lib/localDb.js";
import { apiError } from "@/lib/apiErrors.js";
import { requireRole, getSessionClaims } from "@/lib/auth/middleware.js";
import { canAssignRole, hasUserRole, USER_ROLES, USER_ROLE_LEVELS } from "@/lib/auth/rbac.js";
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 10;

function sanitizeUser(user) {
  if (!user || typeof user !== "object") return user;
  const { password_hash, password, ...safe } = user;
  return safe;
}

/**
 * See route.js (collection) for rationale: requireRole does not forward claims
 * and grants open-mode access without a JWT, so we re-read them here and model
 * the open-mode owner as a superadmin with a null userId (self-* guards inert).
 */
async function resolveActor() {
  const claims = await getSessionClaims();
  if (!claims) {
    return { role: USER_ROLES.SUPERADMIN, userId: null, username: null };
  }
  return { role: claims.role, userId: claims.userId, username: claims.username };
}

function roleLevel(role) {
  return USER_ROLE_LEVELS[role] ?? 0;
}

async function patchUserHandler(request, context) {
  const { id } = await context.params;

  let body;
  try {
    body = await request.json();
  } catch {
    return apiError(request, 400, "Invalid JSON body");
  }
  if (!body || typeof body !== "object") {
    return apiError(request, 400, "Request body must be a JSON object");
  }

  const target = await getUserById(id);
  if (!target) {
    return apiError(request, 404, "User not found");
  }

  const actor = await resolveActor();

  // Never trust a caller-supplied hash; password changes go through bcrypt.
  delete body.password_hash;
  // id is immutable; localDb also strips it, but be explicit.
  delete body.id;

  const updates = {};

  // ── Role change handling ────────────────────────────────────────────────
  if (typeof body.role === "string" && body.role && body.role !== target.role) {
    const newRole = body.role;

    // (1) Actor must be permitted to assign the requested role at all.
    //     admin -> may assign only user/viewer; superadmin -> any.
    if (!canAssignRole(actor.role, newRole)) {
      return apiError(request, 403, `Forbidden: you may not assign the role "${newRole}"`);
    }

    // (2) No self role-UPGRADE: changing your OWN account to a higher level is a
    //     privilege escalation and is blocked regardless of actor role.
    const isSelf = actor.userId != null && actor.userId === target.id;
    if (isSelf && roleLevel(newRole) > roleLevel(target.role)) {
      return apiError(request, 403, "Forbidden: cannot upgrade your own role");
    }

    updates.role = newRole;
  }

  // ── Other mutable fields ────────────────────────────────────────────────
  if (typeof body.email === "string") {
    updates.email = body.email.trim();
  }
  if (typeof body.username === "string" && body.username.trim()) {
    updates.username = body.username.trim();
  }
  if (typeof body.is_active === "boolean") {
    // Mirror the DELETE guards: (de)activating a privileged target via PATCH must
    // require the same authority as DELETE, else an admin could reactivate (or
    // disable) an admin/superadmin account through this side door.
    if (hasUserRole(target.role, USER_ROLES.ADMIN) && !canAssignRole(actor.role, target.role)) {
      return apiError(request, 403, "Forbidden: only a superadmin may change the active state of an admin or superadmin");
    }
    // Lockout guard: never let an actor deactivate their own account via PATCH.
    if (body.is_active === false && actor.userId != null && actor.userId === target.id) {
      return apiError(request, 403, "Forbidden: cannot deactivate your own account");
    }
    updates.is_active = body.is_active;
  }

  // ── Password change (hash plaintext) ────────────────────────────────────
  if (typeof body.password === "string" && body.password) {
    try {
      updates.password_hash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    } catch (error) {
      console.log("Error hashing password:", error);
      return apiError(request, 500, "Failed to process password");
    }
  }

  if (Object.keys(updates).length === 0) {
    return apiError(request, 400, "No updatable fields provided");
  }

  try {
    const updated = await updateUser(id, updates);
    if (!updated) {
      return apiError(request, 404, "User not found");
    }
    return NextResponse.json({ user: sanitizeUser(updated) });
  } catch (error) {
    if (/already exists/i.test(error?.message || "")) {
      return apiError(request, 409, "A user with that username already exists");
    }
    console.log("Error updating user:", error);
    return apiError(request, 500, "Failed to update user");
  }
}

async function deleteUserHandler(request, context) {
  const { id } = await context.params;

  const target = await getUserById(id);
  if (!target) {
    return apiError(request, 404, "User not found");
  }

  const actor = await resolveActor();

  // Lockout guard: never let an actor deactivate their own account.
  if (actor.userId != null && actor.userId === target.id) {
    return apiError(request, 403, "Forbidden: cannot deactivate your own account");
  }

  // Privilege guard: only a superadmin may deactivate an admin/superadmin.
  // canAssignRole(actor, target.role) is true for superadmin on any role and
  // for admins only on user/viewer — exactly the semantics we want here.
  if (hasUserRole(target.role, USER_ROLES.ADMIN) && !canAssignRole(actor.role, target.role)) {
    return apiError(request, 403, "Forbidden: only a superadmin may deactivate an admin or superadmin");
  }

  try {
    const deactivated = await deactivateUser(id);
    if (!deactivated) {
      return apiError(request, 404, "User not found");
    }
    return NextResponse.json({ user: sanitizeUser(deactivated) });
  } catch (error) {
    console.log("Error deactivating user:", error);
    return apiError(request, 500, "Failed to deactivate user");
  }
}

export const PATCH = requireRole(USER_ROLES.ADMIN, patchUserHandler);
export const DELETE = requireRole(USER_ROLES.ADMIN, deleteUserHandler);
