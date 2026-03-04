/**
 * Shared OAuth Secret Utilities
 * Centralized handling for OAuth client secrets with fallback validation
 */

/**
 * Check if a client secret is usable (not redacted, not a placeholder)
 * @param {string} secret - The secret to validate
 * @returns {boolean} - True if the secret is usable
 */
export function isUsableClientSecret(secret) {
  if (typeof secret !== "string") return false;
  const value = secret.trim();
  if (!value) return false;
  const upper = value.toUpperCase();
  return !upper.includes("REDACTED") && !upper.includes("PLACEHOLDER");
}

/**
 * Resolve OAuth client secret with fallback to open-sse config
 * Only uses fallback in development mode to prevent production misconfigurations
 * @param {string} providerName - The provider name (e.g., 'antigravity', 'gemini-cli')
 * @param {object} config - The primary config object with clientSecret property
 * @returns {Promise<string|null>} - The resolved secret or null
 */
export async function resolveOAuthClientSecret(providerName, config) {
  // First try the primary config
  if (isUsableClientSecret(config?.clientSecret)) {
    return config.clientSecret.trim();
  }

  // In production, warn if primary config is missing
  const isDevelopment = process.env.NODE_ENV === "development";
  if (!isDevelopment && !isUsableClientSecret(config?.clientSecret)) {
    console.warn(
      `[OAuth] Client secret for "${providerName}" not configured in primary config. ` +
      `Set OAUTH_${providerName.toUpperCase()}_CLIENT_SECRET or configure in oauth constants.`
    );
  }

  // Fallback to open-sse config (only in development - never in production)
  // Use path from cwd so this works when running from Next compiled output (.next/server).
  if (isDevelopment) {
    try {
      const path = (await import("path")).default;
      const { pathToFileURL } = await import("url");
      const constantsPath = path.join(process.cwd(), "open-sse", "config", "constants.js");
      const { PROVIDERS: OPEN_SSE_PROVIDERS } = await import(pathToFileURL(constantsPath).href);
      const fallback = OPEN_SSE_PROVIDERS?.[providerName]?.clientSecret;
      if (isUsableClientSecret(fallback)) {
        return fallback.trim();
      }
    } catch (error) {
      // Optional fallback only; ignore if open-sse constants are unavailable.
    }
  } else {
    console.warn(
      `[OAuth] Fallback client secret for "${providerName}" blocked in production. ` +
      `Set OAUTH_${providerName.toUpperCase()}_CLIENT_SECRET environment variable.`
    );
  }

  return null;
}
