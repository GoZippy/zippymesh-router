import assert from "assert";
import { buildProviderUrl, buildProviderHeaders, getProviderConfig } from "../open-sse/services/provider.js";

function run() {
  console.log("Running Kilo routing tests...");

  const config = getProviderConfig("kilo");
  assert(config.baseUrl === "https://api.kilo.ai/api/gateway/chat/completions", "Kilo base URL should target Kilo gateway");
  assert(config.format === "openai", "Kilo should be treated as OpenAI-compatible format");

  const url = buildProviderUrl("kilo", "kilo/auto", false);
  assert(url === "https://api.kilo.ai/api/gateway/chat/completions", "Kilo provider URL should not fall back to OpenAI");

  const headers = buildProviderHeaders("kilo", { apiKey: "kilo_test_key" }, false);
  assert(headers.Authorization === "Bearer kilo_test_key", "Kilo should use Bearer API key auth");
  assert(headers["Content-Type"] === "application/json", "Kilo should send JSON content type");

  console.log("All Kilo routing tests passed.");
}

run();
