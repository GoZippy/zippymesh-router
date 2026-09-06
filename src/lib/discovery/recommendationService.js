/**
 * Model Recommendation Engine
 * Provides intelligent recommendations based on task intent and constraints
 */

import { getDiscoveryCatalog } from "./catalogService.js";

/**
 * How far a thinking model is pushed down for a request that did not ask for
 * reasoning. Large enough to lose to the `fast` bonus (+8) it would otherwise
 * tie with, small enough that a thinking model still wins when it is the only
 * thing that matches the intent (a missing REQUIRED capability is -50 and an
 * early return, which no penalty here can outrank).
 */
const THINKING_PENALTY = 12;

/**
 * Score a model based on intent and constraints.
 *
 * `constraints` is normalised with `|| {}` rather than a parameter default:
 * a default only fires on `undefined`, and the caller used to pass an explicit
 * `null` (smartRouter's `parseConstraintsFromRequest` returned null when no
 * X-* header was present). That threw `Cannot read properties of null (reading
 * 'maxCostPerMTokens')` on every plain `{"model":"auto"}` request and took the
 * whole smart-routing path down with it. Both ends are now null-safe.
 */
function scoreModel(model, intent, constraintsInput = {}) {
  const constraints = constraintsInput || {};
  let score = 0;
  const reasons = [];

  // Intent matching: 0-40 points
  const intentsRequiringCapability = {
    code: ["code"],
    vision: ["vision"],
    reasoning: ["reasoning"],
    embedding: ["embedding"],
    fast: ["fast"],
    chat: [],
    default: [],
  };

  const capabilities = Array.isArray(model?.capabilities) ? model.capabilities : [];
  const requiredCaps = intentsRequiringCapability[intent] || [];
  let hasAllRequired = requiredCaps.every(cap => capabilities.includes(cap));

  if (hasAllRequired) {
    score += 40;
    if (requiredCaps.length > 0) {
      reasons.push(`Has required capabilities for ${intent}: ${requiredCaps.join(", ")}`);
    }
  } else if (requiredCaps.length > 0) {
    score -= 50; // Major penalty if missing required capabilities
    reasons.push(`Missing required capabilities: ${requiredCaps.join(", ")}`);
    return { score: Math.max(0, score), reasons, passesConstraints: false };
  }

  // Constraint checking and penalties
  let passesConstraints = true;

  // Cost constraint
  if (constraints.maxCostPerMTokens !== undefined && model.inputPrice) {
    if (model.inputPrice > constraints.maxCostPerMTokens) {
      passesConstraints = false;
      reasons.push(
        `Exceeds max cost: $${model.inputPrice} > $${constraints.maxCostPerMTokens}`
      );
    }
  }

  // Latency constraint
  if (constraints.maxLatencyMs !== undefined) {
    const estimatedLatency = model.isFast ? 2000 : 5000;
    if (estimatedLatency > constraints.maxLatencyMs) {
      score -= 20;
      reasons.push(`May exceed latency requirement: ~${estimatedLatency}ms`);
    } else if (model.isFast) {
      score += 5;
      reasons.push("Meets fast latency requirement");
    }
  }

  // Context window constraint
  if (
    constraints.minContextWindow !== undefined &&
    model.contextWindow !== null
  ) {
    if (model.contextWindow < constraints.minContextWindow) {
      score -= 15;
      reasons.push(
        `Context window too small: ${model.contextWindow} < ${constraints.minContextWindow}`
      );
    }
  }

  // Free tier preference
  if (constraints.preferFree && model.isFree) {
    score += 15;
    reasons.push("Matches free tier preference");
  } else if (constraints.preferFree && !model.isFree) {
    score -= 10;
    reasons.push("User prefers free, this is paid");
  }

  // Local preference
  if (constraints.preferLocal && model.local) {
    score += 10;
    reasons.push("Local model (privacy/speed)");
  } else if (constraints.preferLocal && !model.local) {
    score -= 5;
    reasons.push("Not local (cloud-based)");
  }

  /* ------------------------------------------------------------------ *
   * Capability bonuses.
   *
   * Two changes, 2026-08-30 adversarial round (finding H6 / the AUTO item):
   *
   * 1. **Vision is no longer an unconditional bonus.** `{"model":"auto"}` on a
   *    plain text prompt used to award +5 for vision and therefore pick the
   *    slowest local model on the box — verified: `x-routing-reason: Has vision
   *    capability (+5)`, `x-routing-score: 56`, 21-22 s for "Say OK" against
   *    0.8 s for a text model. A vision model is only better when there is
   *    something to look at, so the bonus is now gated on the request actually
   *    carrying an image part (`constraints.hasImageInput`) or on an explicit
   *    `X-Intent: vision`.
   *
   * 2. **A thinking model is a last resort for a plain intent.** Its answer
   *    lands in `message.reasoning` while `message.content` stays `""` until the
   *    thinking budget is spent, so a conformant OpenAI client reading
   *    `choices[0].message.content` gets an empty string. When the caller has
   *    not asked for reasoning (`constraints.avoidThinking`), a
   *    reasoning-capable model loses the +3 and takes a penalty instead. The
   *    penalty is uniform, so on a box where EVERY model is a thinking model the
   *    ordering is unchanged and `auto` still answers — "a thinking model is
   *    chosen only when the intent asks for reasoning, or nothing else serves
   *    the request".
   * ------------------------------------------------------------------ */
  const bonusCapabilities = {
    reasoning: 3,
    fast: 8,
    premium: 2,
  };

  const wantsVision = intent === "vision" || constraints.hasImageInput === true;
  if (capabilities.includes("vision")) {
    if (wantsVision) {
      score += 5;
      reasons.push("Has vision capability (+5)");
    } else {
      // Deliberately does NOT contain the phrase "Has vision capability": that
      // exact string is what the review found on the wire as `x-routing-reason`,
      // and both the e2e suite and a human reading a header key off it.
      reasons.push("Vision not scored (text-only request)");
    }
  }

  const avoidThinking = constraints.avoidThinking === true && intent !== "reasoning";

  for (const [cap, bonus] of Object.entries(bonusCapabilities)) {
    if (!capabilities.includes(cap)) continue;
    if (cap === "reasoning" && avoidThinking) {
      score -= THINKING_PENALTY;
      reasons.push(`Thinking model deprioritised for a ${intent} request (-${THINKING_PENALTY})`);
      continue;
    }
    score += bonus;
    reasons.push(`Has ${cap} capability (+${bonus})`);
  }

  // Source preference
  if (model.source === "registry") {
    score += 3;
    reasons.push("Recently verified (in registry)");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons,
    passesConstraints,
  };
}

/**
 * Get model recommendations for a task
 */
export async function getRecommendations(intent, constraintsInput = {}, contextInput = "") {
  // Null-safe: callers pass an explicit null for "no constraints" (a parameter
  // default only fires on undefined). See scoreModel().
  const constraints = constraintsInput || {};
  const context = typeof contextInput === "string" ? contextInput : "";
  const catalog = await getDiscoveryCatalog();
  const models = catalog.models || [];

  // Filter by constraints first
  const candidates = models.filter(m => {
    if (!m) return false;

    // Must not be deprecated
    if (m.deprecated) return false;

    // Must be available (not marked as unavailable)
    if (m.source === "static" && !m.metadata?.active) return false;

    return true;
  });

  // Score all candidates
  const scored = candidates
    .map(model => {
      const evaluation = scoreModel(model, intent, constraints);
      return {
        model,
        ...evaluation,
      };
    })
    .sort((a, b) => {
      // First sort by constraint satisfaction
      if (a.passesConstraints !== b.passesConstraints) {
        return a.passesConstraints ? -1 : 1;
      }
      // Then by score
      return b.score - a.score;
    });

  // Return top 3 recommendations
  const recommendations = scored.slice(0, 3).map((item, rank) => ({
    rank: rank + 1,
    modelId: item.model.id,
    provider: item.model.provider,
    name: item.model.name,
    fullModel: item.model.fullModel,
    capabilities: item.model.capabilities,
    score: item.score,
    reasoning: item.reasons,
    metadata: {
      isFree: item.model.isFree,
      local: item.model.local,
      inputPrice: item.model.inputPrice,
      contextWindow: item.model.contextWindow,
    },
  }));

  // Build fallback chain (progressively more lenient)
  const fallbackChain = [
    recommendations[0]?.modelId,
    recommendations[1]?.modelId,
    recommendations[2]?.modelId,
    // Add a free fallback
    models.find(m => m.isFree && !m.deprecated)?.id,
    // Add a local fallback
    models.find(m => m.local && !m.deprecated)?.id,
  ].filter(Boolean);

  return {
    intent,
    context: context.substring(0, 200), // Truncate context for response
    constraints,
    generatedAt: new Date().toISOString(),
    recommendations,
    fallbackChain,
    allCandidates: scored.length,
    summary: `Found ${recommendations.length} suitable models out of ${candidates.length} candidates`,
  };
}

/**
 * Get models by capability
 */
export async function getModelsByCapability(capability, constraints = {}) {
  const catalog = await getDiscoveryCatalog();

  const models = catalog.models
    .filter(m => m.capabilities.includes(capability) && !m.deprecated)
    .map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      capabilities: m.capabilities,
      isFree: m.isFree,
      local: m.local,
      contextWindow: m.contextWindow,
    }))
    .slice(0, 20);

  return {
    capability,
    count: models.length,
    models,
  };
}

/**
 * Validate if a model can handle a request
 */
export async function validateModel(modelId, intent, requirements = {}) {
  const catalog = await getDiscoveryCatalog();
  const model = catalog.models.find(m => m.id === modelId);

  if (!model) {
    return {
      valid: false,
      reason: "Model not found in catalog",
      suggestions: [],
    };
  }

  const issues = [];

  // Check required capabilities
  if (requirements.requiredCapabilities) {
    const missing = requirements.requiredCapabilities.filter(
      cap => !model.capabilities.includes(cap)
    );
    if (missing.length > 0) {
      issues.push(`Missing capabilities: ${missing.join(", ")}`);
    }
  }

  // Check context window
  if (
    requirements.contextWindow &&
    model.contextWindow &&
    model.contextWindow < requirements.contextWindow
  ) {
    issues.push(
      `Context window too small: ${model.contextWindow} < ${requirements.contextWindow}`
    );
  }

  // Check cost
  if (
    requirements.maxCost &&
    model.inputPrice &&
    model.inputPrice > requirements.maxCost
  ) {
    issues.push(
      `Cost exceeds limit: $${model.inputPrice} > $${requirements.maxCost}`
    );
  }

  if (issues.length > 0) {
    // Get alternatives
    const recommendations = await getRecommendations(intent, {
      maxCostPerMTokens: requirements.maxCost,
      minContextWindow: requirements.contextWindow,
    });

    return {
      valid: false,
      model: modelId,
      issues,
      suggestions: recommendations.recommendations.map(r => r.modelId),
    };
  }

  return {
    valid: true,
    model: modelId,
    reason: "Model meets all requirements",
  };
}
