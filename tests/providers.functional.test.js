import assert from "assert";
import {
  getProvider,
  getProviderNames,
  generateAuthData,
  pollForToken,
} from "../src/lib/oauth/providers.js";

async function withMockedFetch(mockResponse, fn) {
  const originalFetch = global.fetch;
  // Mock fetch returns a function that returns a Promise resolving to the response
  global.fetch = (url) => {
    // Only mock token endpoint to prevent cross-test pollution and catch unexpected calls
    if (typeof url === 'string' && url.includes('/token')) {
      return Promise.resolve(mockResponse);
    }
    // For non-token URLs, throw to surface unexpected network calls in tests
    return Promise.reject(new Error(`Unexpected fetch to ${url}`));
  };
  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

async function run() {
  console.log("Running comprehensive provider flow tests...");

  const providerNames = getProviderNames();
  assert(providerNames.length >= 10, "Expected provider registry to include many providers");

  for (const name of providerNames) {
    const provider = getProvider(name);
    assert(provider.flowType, `Provider '${name}' must define flowType`);
  }

  // Auth URL generation contracts
  const authProviders = ["claude", "codex", "gemini-cli", "antigravity", "iflow"];
  for (const name of authProviders) {
    const auth = generateAuthData(name, "http://localhost:20128/callback");
    assert(auth.authUrl && auth.authUrl.startsWith("http"), `${name} should generate auth URL`);
  }

  // Device code providers should not have upfront auth URL
  const deviceProviders = ["qwen", "github", "kiro"];
  for (const name of deviceProviders) {
    const auth = generateAuthData(name, null);
    assert(auth.authUrl === null, `${name} should not generate direct auth URL for device flow`);
    assert(auth.codeVerifier, `${name} should provide code verifier for polling/session context`);
  }

  // Token map contracts
  {
    const claude = getProvider("claude");
    const mapped = claude.mapTokens({
      access_token: "a1",
      refresh_token: "r1",
      expires_in: 3600,
    });
    assert(mapped.accessToken === "a1");
    assert(mapped.refreshToken === "r1");
    assert(mapped.expiresIn === 3600);
  }
  {
    const cursor = getProvider("cursor");
    const mapped = cursor.mapTokens({
      accessToken: "cursor-at",
      machineId: "machine-1",
      expiresIn: 7200,
    });
    assert(mapped.accessToken === "cursor-at");
    assert(mapped.providerSpecificData.machineId === "machine-1");
  }
  {
    const kiro = getProvider("kiro");
    const mapped = kiro.mapTokens({
      access_token: "kiro-at",
      refresh_token: "kiro-rt",
      expires_in: 1800,
      _clientId: "client-id",
      _clientSecret: "client-secret",
    });
    assert(mapped.accessToken === "kiro-at");
    assert(mapped.providerSpecificData.clientId === "client-id");
  }

  // Kiro poll: snake_case success
  await withMockedFetch(
    {
      ok: true,
      async json() {
        return {
          access_token: "at-snake",
          refresh_token: "rt-snake",
          expires_in: 3600,
        };
      },
    },
    async () => {
      const result = await pollForToken("kiro", "dev-code", null, {
        _clientId: "id",
        _clientSecret: "secret",
      });
      assert(result.success === true, "Kiro snake_case response should be successful");
      assert(result.tokens.accessToken === "at-snake");
    }
  );

  // Kiro poll: camelCase success
  await withMockedFetch(
    {
      ok: true,
      async json() {
        return {
          accessToken: "at-camel",
          refreshToken: "rt-camel",
          expiresIn: 3600,
        };
      },
    },
    async () => {
      const result = await pollForToken("kiro", "dev-code", null, {
        _clientId: "id",
        _clientSecret: "secret",
      });
      assert(result.success === true, "Kiro camelCase response should be successful");
      assert(result.tokens.accessToken === "at-camel");
    }
  );

  // Kiro poll: AWS-style pending error normalization
  await withMockedFetch(
    {
      ok: false,
      async json() {
        return {
          error: "AuthorizationPendingException",
          error_description: "authorization is still pending",
        };
      },
    },
    async () => {
      const result = await pollForToken("kiro", "dev-code", null, {
        _clientId: "id",
        _clientSecret: "secret",
      });
      assert(result.success === false);
      assert(result.pending === true, "AuthorizationPendingException should be treated as pending");
      assert(result.error === "authorization_pending");
    }
  );

  console.log("All comprehensive provider flow tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

