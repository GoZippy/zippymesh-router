import { requiresOAuthClientSecret } from "../constants/providers.js";

const STRIP_KEYS = new Set(["clientsecret", "_clientsecret"]);

export function stripSecretFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripSecretFields);
  }

  if (value && typeof value === "object") {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (STRIP_KEYS.has(lower)) continue;
      output[key] = stripSecretFields(child);
    }
    return output;
  }

  return value;
}

export function getProviderMetadata(connection) {
  return connection?.providerSpecificData || connection?.metadata || {};
}

export function hasOAuthClientSecret(connection) {
  const metadata = getProviderMetadata(connection);
  const provider = connection?.provider;

  return Boolean(
    metadata?.oauth?.[provider]?.clientSecret ||
    metadata?.oauth?.clientSecret ||
    metadata?.clientSecret ||
    metadata?._clientSecret
  );
}

export function toSafeProviderConnection(connection) {
  const cloned = connection ? { ...connection } : {};
  const metadata = getProviderMetadata(connection);
  const secretPresent = hasOAuthClientSecret(connection);
  const requiresSecret = connection?.authType === "oauth" && requiresOAuthClientSecret(connection?.provider);
  const tokenExpired = Boolean(
    connection?.expiresAt &&
      Number.isFinite(new Date(connection.expiresAt).getTime()) &&
      new Date(connection.expiresAt).getTime() <= Date.now()
  );

  let testStatus = cloned.testStatus;
  if (cloned.authType === "oauth" && cloned.isActive && testStatus === "unknown") {
    testStatus = "active";
  }

  // Derive needsReauth: OAuth connections that are expired or explicitly marked as needing reauth
  const needsReauth = Boolean(
    cloned.authType === "oauth" &&
    (testStatus === "needs_reauth" || tokenExpired)
  );

  return {
    ...cloned,
    testStatus,
    expiresAt: connection?.expiresAt || null,
    rateLimitedUntil: connection?.rateLimitedUntil || null,
    providerSpecificData: stripSecretFields(metadata),
    hasOAuthClientSecret: secretPresent,
    oauthRequiresClientSecret: requiresSecret,
    oauthNeedsSecret: requiresSecret && !secretPresent,
    hasRefreshToken: Boolean(connection?.refreshToken),
    tokenExpired,
    needsReauth,
    apiKey: undefined,
    accessToken: undefined,
    refreshToken: undefined,
    idToken: undefined,
  };
}
