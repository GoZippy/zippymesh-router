import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/middleware.js";

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set.");
}

/**
 * Shutdown handler — gated to the SUPERADMIN user-account role.
 *
 * requireSuperadmin() preserves the prior auth posture (rate limit + reject
 * missing/invalid sessions) and ADDS a role check so admin/user/viewer can no
 * longer shut the node down. (Per PORT_AND_ADMIN_SYSTEM_PLAN.md §3c, shutdown is
 * superadmin-only.) In login-disabled single-user installs the caller is
 * treated as superadmin, matching the rest of the auth layer.
 */
async function shutdownHandler(request) {
  const response = NextResponse.json({ success: true, message: "Shutting down..." });

  setTimeout(() => {
    process.exit(0);
  }, 500);

  return response;
}

export const POST = requireSuperadmin(shutdownHandler);

