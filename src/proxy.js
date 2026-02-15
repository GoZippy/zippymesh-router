import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set.");
}
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Root redirect
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Public APIs (normalize path)
  const normalizedPath = pathname.replace(/\/$/, "");
  const isPublicApi = [
    "/api/auth/login",
    "/api/settings/require-login",
    "/api/init",
    "/api/health",
    "/api/models/available",
    "/api/cli-tools/openclaw-settings"
  ].includes(normalizedPath);

  // AI V1 APIs handle their own authentication (API Key check)
  const isV1Api = pathname.startsWith("/api/v1") || pathname.startsWith("/v1");

  // Protect all dashboard routes and management APIs
  const isDashboard = pathname.startsWith("/dashboard");
  const isManagementApi = pathname.startsWith("/api") && !isPublicApi && !isV1Api;

  if (isDashboard || isManagementApi) {
    const token = request.cookies.get("auth_token")?.value;

    if (token) {
      try {
        await jwtVerify(token, SECRET);
        return NextResponse.next();
      } catch (err) {
        if (isManagementApi) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    // Optional: Allow non-authenticated dashboard if require-login is false
    if (isDashboard) {
      const origin = request.nextUrl.origin;
      try {
        const res = await fetch(`${origin}/api/settings/require-login`);
        const data = await res.json();
        if (data.requireLogin === false) {
          return NextResponse.next();
        }
      } catch (err) { }
      return NextResponse.redirect(new URL("/login", request.url));
    }

    // Management APIs always require authentication
    if (isManagementApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/api/:path*", "/v1/:path*"],
};
