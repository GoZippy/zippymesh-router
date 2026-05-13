/**
 * Model Recommendation Engine
 * Provides intelligent recommendations based on task intent and constraints
 */

import { getDiscoveryCatalog } from "./catalogService.js";

/**
 * Score a model based on intent and constraints
 */
function scoreModel(model, intent, constraints = {}) {
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

  const requiredCaps = intentsRequiringCapability[intent] || [];
  let hasAllRequired = requiredCaps.every(cap =>
    model.capabilities.includes(cap)
  );

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

  // Capability bonus points (extra features)
  const bonusCapabilities = {
    vision: 5,
    reasoning: 3,
    fast: 8,
    premium: 2,
  };

  for (const [cap, bonus] of Object.entries(bonusCapabilities)) {
    if (model.capabilities.includes(cap)) {
      score += bonus;
      reasons.push(`Has ${cap} capability (+${bonus})`);
    }
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
export async function getRecommendations(intent, constraints = {}, context = "") {
  const catalog = await getDiscoveryCatalog();
  const models = catalog.models;

  // Filter by constraints first
  const candidates = models.filter(m => {
    // Must not be deprecated
    if (m.deprecated) return false;

    // Must be available (not marked as unavailable)
    if (m.source === "static" && !m.metadata.active) return false;

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
