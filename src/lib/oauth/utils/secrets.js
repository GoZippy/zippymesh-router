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

  // Fallback to open-sse config (only in development or if explicitly configured)
  try {
    const { PROVIDERS: OPEN_SSE_PROVIDERS } = await import("../../../../open-sse/config/constants.js");
    const fallback = OPEN_SSE_PROVIDERS?.[providerName]?.clientSecret;
    if (isUsableClientSecret(fallback)) {
      if (!isDevelopment) {
        console.warn(
          `[OAuth] Using fallback client secret for "${providerName}" from open-sse config. ` +
          `This should be configured in the primary OAuth constants for production.`
        );
      }
      return fallback.trim();
    }
  } catch (error) {
    // Optional fallback only; ignore if open-sse constants are unavailable.
  }

  return null;
}
