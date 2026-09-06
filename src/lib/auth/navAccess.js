/**
 * Pure, SSR/import-safe helpers for role-based sidebar nav gating.
 *
 * These contain NO React, no browser-only globals, and no I/O — they only map a
 * user-account role to UI visibility decisions, so they are trivially unit
 * testable and safe to import from anywhere (server or client).
 *
 * SECURITY NOTE: this gate is a UI CONVENIENCE only. Real authorization is
 * enforced server-side by requireRole() on the admin APIs. Hiding a control
 * here never substitutes for the server check; it just avoids dangling links.
 *
 * Fail-closed: an unknown / missing / null role grants NO privileged visibility.
 *
 * Imports the PURE role model from ./roles.js (not ./rbac.js): rbac.js pulls in
 * localDb.js (node:os/fs/crypto) via resolveTeamContext, which breaks the client
 * bundle. roles.js is dependency-free and client-safe.
 */
import { hasUserRole, USER_ROLES } from "./roles.js";

/**
 * May a role see the "Admin" dashboard nav entry?
 * Visible to admin and superadmin (admin+). Everyone else: false.
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
export function canSeeAdmin(role) {
  return hasUserRole(role, USER_ROLES.ADMIN);
}

/**
 * May a role see the "Shutdown" control?
 * Restricted to superadmin only — stopping the service is the most privileged
 * action, so it fails closed for admin and below.
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
export function canSeeShutdown(role) {
  return hasUserRole(role, USER_ROLES.SUPERADMIN);
}

/**
 * Filter a list of nav items by the caller's role.
 *
 * An item may declare a `minRole` (a user-account role string). Items WITHOUT a
 * `minRole` are unrestricted and always pass through. Items WITH a `minRole` are
 * kept only when the role satisfies it (fail-closed for unknown/null roles).
 *
 * The input array is never mutated; a new filtered array is returned.
 *
 * @param {Array<{minRole?: string}>} items
 * @param {string|null|undefined} role
 * @returns {Array}
 */
export function filterNavByRole(items, role) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    if (!item || typeof item !== "object") return false;
    if (!item.minRole) return true; // unrestricted entry
    return hasUserRole(role, item.minRole);
  });
}
