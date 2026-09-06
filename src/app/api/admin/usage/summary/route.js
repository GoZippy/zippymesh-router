import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { requireRole, getSessionClaims } from "@/lib/auth/middleware.js";
import { USER_ROLES, hasUserRole } from "@/lib/auth/rbac.js";
import { summarizeUsage } from "@/lib/usageDb.js";

/**
 * GET /api/admin/usage/summary — aggregated per-user usage attribution.
 *
 * Authz (PORT_AND_ADMIN_SYSTEM_PLAN.md §4): gated by requireRole('viewer'), the
 * lowest role permitted READ access. The wrapper enforces auth + the floor; this
 * handler then applies the visibility rule on top:
 *
 *   - admin / superadmin: may see ALL users. An optional `?userId=` narrows the
 *     `totals` to one user; omitted -> totals across everyone. The full per-user
 *     `byUser` breakdown is always returned.
 *   - user / viewer (non-admin): FORCED to their own session userId. Any
 *     `?userId=` that isn't their own is ignored (we never honour a spoofed id)
 *     and `byUser` is collapsed to only their own bucket so they cannot read
 *     another user's totals. Fail-closed: a non-admin with no resolvable
 *     session userId sees nothing attributable to them.
 *
 * Back-compat: summarizeUsage() buckets legacy records (no userId) as
 * 'unattributed' and never throws on a missing field, so a missing/legacy field
 * never errors the route.
 */
async function handler(request) {
  try {
    const url = new URL(request.url);
    const requestedUserId = url.searchParams.get("userId");

    // Re-read the verified claims to learn WHO is asking and at what role.
    // requireRole has already guaranteed the role floor + auth; in open mode
    // (requireLogin===false) there may be no claims, which requireRole treated as
    // superadmin — mirror that here so single-user installs see everything.
    const claims = await getSessionClaims();
    const role = claims?.role;
    const isAdmin =
      hasUserRole(role, USER_ROLES.ADMIN) ||
      // Open-mode parity: no claims but the wrapper let us through => treat as admin.
      claims === null;

    if (isAdmin) {
      // Admin/superadmin: honour the optional filter as-is (null => all users).
      const summary = await summarizeUsage({ userId: requestedUserId ?? undefined });
      return NextResponse.json({ scope: "all", ...summary });
    }

    // Non-admin (user/viewer): force to OWN userId, ignore any spoofed ?userId.
    const ownUserId = claims?.userId;
    if (ownUserId === undefined || ownUserId === null || ownUserId === "") {
      // Fail-closed: an authenticated non-admin with no identifiable userId can
      // attribute nothing to themselves — return empty totals rather than leak.
      return NextResponse.json({
        scope: "self",
        totals: { requests: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 },
        byUser: {},
        filteredUserId: null,
      });
    }

    const summary = await summarizeUsage({ userId: ownUserId });
    const ownKey = String(ownUserId);
    // Collapse the breakdown to only the caller's own bucket — never expose other
    // users' rows to a non-admin.
    const ownBreakdown = summary.byUser[ownKey] ? { [ownKey]: summary.byUser[ownKey] } : {};
    return NextResponse.json({
      scope: "self",
      totals: summary.totals,
      byUser: ownBreakdown,
      filteredUserId: ownKey,
    });
  } catch (error) {
    console.error("Error aggregating admin usage summary:", error);
    return apiError(request, 500, "Failed to aggregate usage");
  }
}

// 'viewer' is the read-only floor: viewer/user/admin/superadmin may GET; the
// per-row visibility rule above further restricts non-admins to their own data.
export const GET = requireRole(USER_ROLES.VIEWER, handler);
