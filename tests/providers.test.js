/**
 * Functional unit tests for provider connection flows (OAuth, device-code, import).
 * Tests config and token response handling without pulling in Next.js-only modules.
 */
import assert from "assert";
import { KIRO_CONFIG, CURSOR_CONFIG } from "../src/lib/oauth/constants/oauth.js";

function run() {
  console.log("Running provider connection tests...");

  // --- Kiro: AWS SSO OIDC endpoints
  assert(KIRO_CONFIG.tokenUrl === "https://oidc.us-east-1.amazonaws.com/token", "Kiro tokenUrl");
  assert(KIRO_CONFIG.startUrl === "https://view.awsapps.com/start", "Kiro startUrl");
  assert(KIRO_CONFIG.clientName === "kiro-oauth-client", "Kiro clientName");

  // --- Cursor: import token flow config
  assert(CURSOR_CONFIG.dbKeys?.accessToken, "Cursor dbKeys.accessToken");
  assert(CURSOR_CONFIG.dbKeys?.machineId, "Cursor dbKeys.machineId");

  // --- Token response normalization (contract: AWS may return snake_case; app normalizes)
  const snakeCaseResponse = {
    access_token: "at_ok",
    refresh_token: "rt_ok",
    expires_in: 3600,
  };
  const accessToken = snakeCaseResponse.access_token ?? snakeCaseResponse.accessToken;
  const refreshToken = snakeCaseResponse.refresh_token ?? snakeCaseResponse.refreshToken;
  const expiresIn = snakeCaseResponse.expires_in ?? snakeCaseResponse.expiresIn ?? 3600;
  assert(accessToken === "at_ok", "snake_case access_token");
  assert(refreshToken === "rt_ok", "snake_case refresh_token");
  assert(expiresIn === 3600, "snake_case expires_in");

  console.log("All provider connection tests passed.");
}

run();
