/**
 * Shared authentication utilities for API routes
 */

import { isAuthenticated } from "./login.js";
import { getSettings } from "../localDb.js";
import { NextResponse } from "next/server";

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
    if (!(await checkAuth())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(request, context);
  };
}
