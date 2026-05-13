/**
 * Shared authentication utilities for API routes
 */

import { isAuthenticated } from "./login.js";
import { getSettings } from "../localDb.js";
import { NextResponse } from "next/server";
import { apiError } from "../apiErrors.js";
import { checkIpRateLimit } from "./ipRateLimit.js";

/**
 * Check if the request is authorized
 * Checks if login is required and if the user is authenticated
 * @returns {Promise<boolean>}
 */
export async function checkAuth() {
  const settings = await getSettings();
  if (settings.requireLogin === false) {
    return true;
  }
  const auth = await isAuthenticated();
  return !!auth;
}

/**
 * Require authentication for an API route handler
 * Returns a 401 response if not authenticated, otherwise executes the handler
 * @param {Function} handler - The route handler to execute if authenticated
 * @returns {Function} Wrapped handler with auth check
 */
export function requireAuth(handler) {
  return async function(request, context) {
    const ip = request.headers.get("x-forwarded-for")?.split(',')[0].trim() 
            || request.headers.get("x-real-ip") 
            || "127.0.0.1";
            
    // Rate limit dashboard APIs: max 300 requests per minute per IP
    const rl = checkIpRateLimit(`dashboard:${ip}`, 300, 60 * 1000);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { 
        status: 429, 
        headers: {
          "Content-Type": "application/json",
          "Retry-After": Math.ceil((rl.resetAt - Date.now()) / 1000).toString()
        }
      });
    }

    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }
    return handler(request, context);
  };
}
