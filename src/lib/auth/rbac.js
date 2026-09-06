/**
 * RBAC helpers. This module hosts TWO INDEPENDENT role models — do not conflate:
 *
 *   1. TEAM-KEY RBAC (virtual API keys): ROLES / ROLE_LEVELS / hasRole /
 *      extractBearerToken / resolveTeamContext. Hierarchy admin > operator >
 *      viewer. Other code depends on these; they are PRE-EXISTING and untouched.
 *
 *   2. USER-ACCOUNT RBAC (dashboard logins): USER_ROLES / USER_ROLE_LEVELS /
 *      hasUserRole / canAssignRole. Hierarchy superadmin > admin > user >
 *      viewer. Carried in the dashboard session JWT `role` claim.
 *
 * These two models share the string "admin" and "viewer" but are SEMANTICALLY
 * DISTINCT. Always pick the helper that matches the credential you are checking.
 */

// ── 1. TEAM-KEY RBAC (virtual API keys) — DO NOT ALTER ─────────────────────
export const ROLES = { ADMIN: 'admin', OPERATOR: 'operator', VIEWER: 'viewer' };
const ROLE_LEVELS = { admin: 3, operator: 2, viewer: 1 };

/**
 * Check if a TEAM-KEY role meets a minimum required role level.
 */
export function hasRole(userRole, requiredRole) {
  return (ROLE_LEVELS[userRole] ?? 0) >= (ROLE_LEVELS[requiredRole] ?? 99);
}

// ── 2. USER-ACCOUNT RBAC (dashboard logins) ────────────────────────────────
// The pure role model lives in ./roles.js (ZERO imports) so client code can use
// it without bundling localDb.js (which imports node:os/fs/crypto). We re-export
// here for backward compatibility — existing server-side importers of this module
// keep working unchanged. Hierarchy: superadmin > admin > user > viewer.
export {
  USER_ROLES,
  USER_ROLE_LEVELS,
  hasUserRole,
  canAssignRole,
} from './roles.js';

/**
 * Extract virtual key from request Authorization header.
 * Returns the key string or null.
 */
export function extractBearerToken(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

/**
 * Resolve the team context from a virtual key.
 * Returns { teamId, orgId, role } or null.
 */
export async function resolveTeamContext(request) {
  try {
    const token = extractBearerToken(request);
    if (!token) return null;
    const crypto = await import('crypto');
    const keyHash = crypto.createHash('sha256').update(token).digest('hex');
    const { getVirtualKeyByHash } = await import('@/lib/localDb.js');
    const vk = getVirtualKeyByHash(keyHash);
    if (!vk) return null;
    return { teamId: vk.team_id, orgId: vk.org_id, role: 'operator', keyName: vk.name };
  } catch (e) {
    return null;
  }
}
