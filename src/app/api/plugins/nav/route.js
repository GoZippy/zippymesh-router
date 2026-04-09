import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { getNavItems } from "@/plugins/index.js";
import { checkAuth } from "@/lib/auth/middleware.js";

/**
 * GET /api/plugins/nav
 * Returns nav items from enabled plugins. Used by Sidebar.
 */
export async function GET(request) {
  try {
    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }
    const navItems = getNavItems();
    return NextResponse.json({ navItems });
  } catch (error) {
    console.error("Plugin nav error:", error);
    return NextResponse.json({ navItems: [] }, { status: 200 });
  }
}
