import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { createRoutingPlaybook, getProviderConnections } from "@/lib/localDb.js";

const SECRET_KEYS = new Set([
  "apikey",
  "apiKey",
  "accessToken",
  "refreshToken",
  "idToken",
  "token",
  "authorization",
  "accountId",
  "wallet_id",
]);

function scrubObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => scrubObject(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const result = {};
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue;
    result[key] = scrubObject(inner);
  }
  return result;
}

function sanitizeRules(rules, availableProviders) {
  const safeRules = [];
  const warnings = [];

  for (const rule of rules || []) {
    if (!rule || typeof rule !== "object") continue;
    const nextRule = {
      type: rule.type,
      target: rule.target,
      value: rule.value,
    };

    if (!nextRule.type) {
      warnings.push("Rule skipped: missing type");
      continue;
    }

    if (typeof nextRule.target === "string" && nextRule.target.includes("/")) {
      const [provider] = nextRule.target.split("/");
      if (!availableProviders.has(provider)) {
        warnings.push(`Rule target '${nextRule.target}' skipped: provider not available`);
        continue;
      }
    } else if (typeof nextRule.target === "string" && !["*", "all"].includes(nextRule.target)) {
      const providerTargets = nextRule.target.split(",").map((item) => item.trim()).filter(Boolean);
      const validTargets = providerTargets.filter((provider) => availableProviders.has(provider));
      if (validTargets.length === 0 && providerTargets.length > 0) {
        warnings.push(`Rule target '${nextRule.target}' skipped: no compatible providers`);
        continue;
      }
      if (validTargets.length > 0) nextRule.target = validTargets.join(",");
    }

    safeRules.push(nextRule);
  }

  return { safeRules, warnings };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const incoming = scrubObject(body?.playbook || body || {});
    const dryRun = body?.dryRun !== false;

    if (!incoming.name) {
      return apiError(request, 400, "Playbook name is required");
    }

    const connections = await getProviderConnections({ isActive: true, isEnabled: true });
    const availableProviders = new Set(connections.map((conn) => conn.provider));
    const { safeRules, warnings } = sanitizeRules(incoming.rules || [], availableProviders);

    const sanitized = {
      name: incoming.name,
      description: incoming.description || "",
      rules: safeRules,
      isActive: incoming.isActive !== false,
      priority: Number(incoming.priority || 0),
    };

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        sanitizedPreview: sanitized,
        warnings,
      });
    }

    const created = await createRoutingPlaybook(sanitized);
    return NextResponse.json({
      dryRun: false,
      playbook: created,
      warnings,
    });
  } catch (error) {
    console.error("Error importing playbook:", error);
    return apiError(request, 500, "Failed to import playbook");
  }
}

