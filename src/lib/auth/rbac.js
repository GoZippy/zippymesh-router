/**
 * RBAC middleware helpers for multi-tenant access control.
 * Role hierarchy: admin > operator > viewer
 */

export const ROLES = { ADMIN: 'admin', OPERATOR: 'operator', VIEWER: 'viewer' };
const ROLE_LEVELS = { admin: 3, operator: 2, viewer: 1 };

/**
 * Check if a role meets a minimum required role level.
 */
export function hasRole(userRole, requiredRole) {
  return (ROLE_LEVELS[userRole] ?? 0) >= (ROLE_LEVELS[requiredRole] ?? 99);
}

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
