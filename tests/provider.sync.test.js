import assert from "assert";
import { __internal } from "../src/lib/providers/sync.js";

function run() {
  console.log("Running provider sync normalization tests...");

  const openrouterPricing = __internal.normalizePricingFromModel("openrouter", "openai/gpt-4o", {
    pricing: {
      prompt: "0.0000025",
      completion: "0.00001",
      input_cache_read: "0.00000125",
      input_cache_write: "0.0000025",
    },
  });
  assert(openrouterPricing, "OpenRouter pricing should be detected");
  assert(openrouterPricing.pricing.input === 2.5, "OpenRouter input should normalize to USD/1M tokens");
  assert(openrouterPricing.pricing.output === 10, "OpenRouter output should normalize to USD/1M tokens");

  const kiloPricing = __internal.normalizePricingFromModel("kilo", "anthropic/claude-sonnet-4.5", {
    pricing: {
      prompt: "0.000003",
      completion: "0.000015",
    },
  });
  assert(kiloPricing, "Kilo pricing should be detected");
  assert(kiloPricing.pricing.input === 3, "Kilo input should normalize to USD/1M tokens");
  assert(kiloPricing.pricing.output === 15, "Kilo output should normalize to USD/1M tokens");

  const coherePricing = __internal.normalizePricingFromModel("cohere", "command-a-03-2025", {
    pricing: {
      prompt: "0.0000025",
      completion: "0.00001",
    },
  });
  assert(coherePricing, "Cohere pricing should be normalized when present");
  assert(coherePricing.pricing.input === 2.5, "Cohere input should normalize to USD/1M tokens");
  assert(coherePricing.pricing.output === 10, "Cohere output should normalize to USD/1M tokens");

  const normalizedFreeModel = __internal.normalizeModelRecord("kilo", {
    id: "z-ai/glm-5:free",
    name: "GLM 5 Free",
    pricing: { prompt: "0", completion: "0" },
    context_length: 128000,
  });
  assert(normalizedFreeModel?.isFree === true, "Free suffix model should be marked free");
  assert(normalizedFreeModel?.contextWindow === 128000, "Context window should be normalized");

  console.log("All provider sync normalization tests passed.");
}

run();

