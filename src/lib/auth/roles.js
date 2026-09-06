/**
 * Pure USER-ACCOUNT role model — the single source of truth for the dashboard
 * login role hierarchy (superadmin > admin > user > viewer).
 *
 * This module has ZERO imports (no Node built-ins, no I/O, no React), so it is
 * safe to import from BOTH server code (middleware, admin APIs) and CLIENT code
 * (Sidebar nav gating via navAccess.js). Keeping it dependency-free is what lets
 * the browser bundle the nav-gating logic without dragging in localDb.js
 * (which imports node:os/node:fs/node:crypto and breaks the client build).
 *
 * rbac.js re-exports these names for backward compatibility, so existing
 * server-side importers of `@/lib/auth/rbac.js` are unaffected.
 */

// Hierarchy mirrors the users-table `role` column and the session JWT `role` claim.
export const USER_ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  USER: 'user',
  VIEWER: 'viewer',
};

export const USER_ROLE_LEVELS = {
  superadmin: 4,
  admin: 3,
  user: 2,
  viewer: 1,
};

/**
 * Check whether a user-account role satisfies a minimum required role.
 *
 * Fail-closed: an unknown/missing `actual` role resolves to level 0 (denied),
 * and an unknown `required` role resolves to a sentinel above the top of the
 * hierarchy so it can never be satisfied by accident.
 *
 * @param {string} actual   the role on the session (e.g. JWT `role`)
 * @param {string} required the minimum role the action demands
 * @returns {boolean}
 */
export function hasUserRole(actual, required) {
  return (USER_ROLE_LEVELS[actual] ?? 0) >= (USER_ROLE_LEVELS[required] ?? 99);
}

/**
 * Decide whether an actor may assign/grant `targetRole` to a user.
 *
 * Rules (per PORT_AND_ADMIN_SYSTEM_PLAN.md §3c):
 *   - superadmin may assign ANY valid role (including admin / superadmin).
 *   - admin may assign ONLY non-privileged roles (user / viewer); admin may
 *     NOT create or upgrade anyone to admin or superadmin (no self/peer
 *     privilege escalation).
 *   - user / viewer may never assign roles.
 * Fail-closed: unknown actor or target roles are denied.
 *
 * @param {string} actorRole   role of the user performing the assignment
 * @param {string} targetRole  role being granted
 * @returns {boolean}
 */
export function canAssignRole(actorRole, targetRole) {
  // Target must be a known user-account role.
  if (!(targetRole in USER_ROLE_LEVELS)) return false;

  if (actorRole === USER_ROLES.SUPERADMIN) {
    return true; // superadmin may assign anything
  }

  if (actorRole === USER_ROLES.ADMIN) {
    // admin may assign only roles strictly BELOW admin (user / viewer).
    return USER_ROLE_LEVELS[targetRole] < USER_ROLE_LEVELS[USER_ROLES.ADMIN];
  }

  // user / viewer / unknown actors may not assign roles.
  return false;
}
