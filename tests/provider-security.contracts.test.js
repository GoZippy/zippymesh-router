import assert from "assert";
import {
  getProviderMetadata,
  hasOAuthClientSecret,
  stripSecretFields,
  toSafeProviderConnection,
} from "../src/shared/utils/providerSecurity.js";
import { maskSensitiveHeaders, sanitizeLogValue } from "../open-sse/utils/requestLogger.js";

function run() {
  console.log("Running provider security contract tests...");

  const now = Date.now();

  const activeWithSecret = {
    id: "conn-1",
    provider: "antigravity",
    authType: "oauth",
    isActive: true,
    testStatus: "unknown",
    expiresAt: new Date(now - 1000).toISOString(),
    apiKey: "ak_live_secret_001",
    accessToken: "at_live_secret_002",
    refreshToken: "rt_live_secret_003",
    idToken: "id_live_secret_004",
    providerSpecificData: {
      oauth: {
        antigravity: {
          clientSecret: "secret-from-provider-specific",
        },
      },
      nested: [{ note: "keep", _clientSecret: "legacy-secret" }],
    },
  };

  const safeWithSecret = toSafeProviderConnection(activeWithSecret);
  assert.strictEqual(getProviderMetadata(activeWithSecret), activeWithSecret.providerSpecificData, "provider metadata should use providerSpecificData");
  assert.strictEqual(hasOAuthClientSecret(activeWithSecret), true, "metadata with clientSecret should be treated as present");
  assert.strictEqual(safeWithSecret.oauthRequiresClientSecret, true, "antigravity should require OAuth client secret");
  assert.strictEqual(safeWithSecret.oauthNeedsSecret, false, "configured secret should satisfy required secret");
  assert.strictEqual(safeWithSecret.hasOAuthClientSecret, true, "response should expose hasOAuthClientSecret");
  assert.strictEqual(safeWithSecret.hasRefreshToken, true, "response should expose hasRefreshToken");
  assert.strictEqual(safeWithSecret.tokenExpired, true, "expired connection should set tokenExpired true");
  assert.strictEqual(safeWithSecret.apiKey, undefined, "api key must be removed");
  assert.strictEqual(safeWithSecret.accessToken, undefined, "access token must be removed");
  assert.strictEqual(safeWithSecret.refreshToken, undefined, "refresh token must be removed");
  assert.strictEqual(safeWithSecret.idToken, undefined, "id token must be removed");
  assert.strictEqual(safeWithSecret.providerSpecificData.clientSecret, undefined, "top-level clientSecret must be removed from metadata");
  assert.strictEqual(safeWithSecret.providerSpecificData.oauth.antigravity.clientSecret, undefined, "nested oauth clientSecret must be removed");
  assert.strictEqual(safeWithSecret.providerSpecificData.nested[0]._clientSecret, undefined, "nested _clientSecret must be removed");

  const activeWithoutSecret = {
    ...activeWithSecret,
    provider: "iflow",
    id: "conn-2",
    apiKey: "ak_live_secret_005",
    providerSpecificData: { oauth: { iflow: { providerHint: "required" } } },
  };
  const safeWithoutSecret = toSafeProviderConnection(activeWithoutSecret);
  assert.strictEqual(safeWithoutSecret.oauthRequiresClientSecret, true, "iflow should require OAuth client secret");
  assert.strictEqual(safeWithoutSecret.oauthNeedsSecret, true, "missing required secret should set oauthNeedsSecret true");
  assert.strictEqual(safeWithoutSecret.hasOAuthClientSecret, false, "missing required secret should not report present");

  const legacyMetadata = {
    ...activeWithSecret,
    id: "conn-3",
    provider: "antigravity",
    authType: "oauth",
    providerSpecificData: null,
    metadata: {
      oauth: {
        antigravity: {
          clientSecret: "legacy-metadata-secret",
        },
      },
    },
  };
  const safeLegacyMetadata = toSafeProviderConnection(legacyMetadata);
  assert.strictEqual(hasOAuthClientSecret(legacyMetadata), true, "legacy metadata clientSecret should still be detected");
  assert.strictEqual(safeLegacyMetadata.providerSpecificData.oauth.antigravity.clientSecret, undefined, "legacy clientSecret should be stripped");

  const secretPayload = {
    providerSpecificData: {
      nested: {
        clientSecret: "inline-secret",
        nestedArray: [
          { _clientSecret: "array-secret", keep: "value" },
          { token: "preserve", clientSecret: "strip-me" },
        ],
      },
      keep: "present",
    },
  };

  const redactedPayload = stripSecretFields(secretPayload);
  assert.strictEqual(redactedPayload.providerSpecificData.nested.clientSecret, undefined, "stripSecretFields should remove clientSecret");
  assert.strictEqual(redactedPayload.providerSpecificData.nested.nestedArray[0]._clientSecret, undefined, "stripSecretFields should remove _clientSecret");
  assert.strictEqual(redactedPayload.providerSpecificData.nested.nestedArray[1].clientSecret, undefined, "stripSecretFields should recurse nested arrays");
  assert.strictEqual(redactedPayload.providerSpecificData.keep, "present", "non-secret metadata should stay intact");

  const maskedHeaders = maskSensitiveHeaders({
    Authorization: "Bearer very_long_authorization_token_1234567890",
    "X-API-Key": "ak_live_super_secret_1234",
    "Content-Type": "application/json",
    Cookie: "session=abc",
    Trace: "value",
  });
  assert.notStrictEqual(maskedHeaders.Authorization, "Bearer very_long_authorization_token_1234567890", "authorization should be masked");
  assert.notStrictEqual(maskedHeaders["X-API-Key"], "ak_live_super_secret_1234", "api key should be masked");
  assert.strictEqual(maskedHeaders["Content-Type"], "application/json", "non-sensitive headers should remain unchanged");
  assert.strictEqual(maskedHeaders.Trace, "value", "unrelated headers should remain unchanged");
  assert.notStrictEqual(maskedHeaders.Cookie, "session=abc", "cookies should be masked");

  const sanitizedBody = sanitizeLogValue({
    model: "gemini-cli",
    access_token: "token-value-should-hide",
    nested: {
      refreshToken: "refresh-token-should-hide",
      safeField: "safe",
      deeper: {
        tokenDescription: "mask-this-too",
      },
    },
    tokens: ["one", { secretHint: "also-hide" }, 42],
  });
  assert.strictEqual(sanitizedBody.access_token, "***", "access token should be masked");
  assert.strictEqual(sanitizedBody.nested.refreshToken, "***", "refresh token should be masked");
  assert.strictEqual(sanitizedBody.nested.safeField, "safe", "non-sensitive payload fields should stay readable");
  assert.strictEqual(sanitizedBody.nested.deeper.tokenDescription, "***", "token-like nested keys should be masked");
  assert.strictEqual(sanitizedBody.tokens[1].secretHint, "***", "secret-like keys in arrays should be masked");

  console.log("All provider security contract tests passed.");
}

run();
