import { NextResponse } from "next/server";
import { getSettings, updateSettings, getFirstRun, writeAuditLog } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { apiError } from "@/lib/apiErrors.js";
import { checkAuth, getSessionClaims } from "@/lib/auth/middleware.js";
import { hasUserRole, USER_ROLES } from "@/lib/auth/rbac.js";

// System / security-sensitive settings keys (subset of PATCH_ALLOWED_KEYS).
// Writing ANY of these requires an admin+ user-account role (superadmin|admin),
// per PORT_AND_ADMIN_SYSTEM_PLAN.md §3c ("PATCH /api/settings (system)").
// Keys NOT listed here are treated as own-profile / cosmetic (e.g. theme,
// dashboardView, poolTableColumns, newPassword/currentPassword) and remain
// writable by any authenticated session, preserving existing behaviour.
const PATCH_SYSTEM_KEYS = new Set([
  "requireLogin", "enforceDeviceIdVerification", "requireApiKey",
  "routingMode", "defaultPlaybookId",
  "enableCrossProviderFailover", "preferLocalForSimpleTasks",
  "preferFreeOnRateLimit", "enableRoutingMemory",
  "fallbackStrategy", "stickyRoundRobinLimit",
  "pricePer1k",
  "meshMode", "meshAllowlist",
  "meshMaxRatePer1kTokensZat", "meshMaxRoutingFeeTotalZat",
  "meshPreferredTrustFloor", "meshAllowLocalFallback",
  "semanticCacheEnabled", "semanticCacheThreshold",
  "semanticCacheEmbeddingModel", "ollamaUrl",
  "autoProviderCatalogSync", "providerCatalogSyncIntervalMinutes",
  "ORACLE_SYNC_ENABLED",
  "disableAutoHealthCheck", "traceRetentionDays",
  "minorVariancePct", "warnVariancePct", "criticalVariancePct",
  "reconciliationMinSampleSize",
  "isDemoMode", "cloudEnabled",
]);

// Explicit allowlist of settings keys writable through the public PATCH route.
// Anything else (including `password`, `firstRun`, `nodeIdentity`,
// `providerCatalogLast*` and other system-managed fields) is rejected with 400.
// Dedicated routes (/api/settings/mesh, /api/settings/webhooks, /api/setup/complete)
// call updateSettings() directly and are not subject to this allowlist.
// The ONLY keys an UNAUTHENTICATED first-run caller may write.
//
// SECURITY (adversarial review 2026-08-30, item 1a): PATCH bypasses its auth
// gate while `firstRun` is true so the setup wizard can set the initial
// password with no session. That bypass covered the whole of
// PATCH_ALLOWED_KEYS, so before setup completed an anonymous caller could send
// `{requireLogin:false}` (or any other system key) and have it written — and,
// because `firstRun` also exempts the role gate below, without an admin role.
// The wizard sends only `{newPassword}` (src/app/setup/page.js), so narrowing
// the bypass to the password pair costs the wizard nothing. Any other key
// during first run falls through to the normal auth + role gate.
const FIRST_RUN_ALLOWED_KEYS = new Set(["newPassword", "currentPassword"]);

const PATCH_ALLOWED_KEYS = new Set([
  "newPassword", "currentPassword",
  "requireLogin", "enforceDeviceIdVerification", "requireApiKey",
  "routingMode", "defaultPlaybookId",
  "enableCrossProviderFailover", "preferLocalForSimpleTasks",
  "preferFreeOnRateLimit", "enableRoutingMemory",
  "fallbackStrategy", "stickyRoundRobinLimit",
  "pricePer1k",
  "meshMode", "meshAllowlist",
  "meshMaxRatePer1kTokensZat", "meshMaxRoutingFeeTotalZat",
  "meshPreferredTrustFloor", "meshAllowLocalFallback",
  "semanticCacheEnabled", "semanticCacheThreshold",
  "semanticCacheEmbeddingModel", "ollamaUrl",
  "autoProviderCatalogSync", "providerCatalogSyncIntervalMinutes",
  "ORACLE_SYNC_ENABLED",
  "disableAutoHealthCheck", "traceRetentionDays",
  "minorVariancePct", "warnVariancePct", "criticalVariancePct",
  "reconciliationMinSampleSize",
  "theme", "dashboardView", "poolTableColumns",
  "isDemoMode", "cloudEnabled",
]);

/**
 * Strip secret material from the settings blob before it leaves the process.
 *
 * SECURITY (2026-08-30 audit, finding C1): GET /api/settings is in the edge
 * middleware's PUBLIC list — no session, no API key, nothing. It used to delete
 * only `password` and return everything else verbatim, but `settings` is a free-
 * form blob that other subsystems write secrets into:
 *
 *   - `nodeIdentity.privateKey` — the node's ed25519 PKCS8 private key, written
 *     by getNodeIdentity() (src/lib/localDb.js) and used by src/lib/security.js
 *     to sign mesh messages. Generated automatically on first /api/init, so it
 *     is present on essentially every install. Disclosing it lets anyone forge
 *     this node's mesh identity.
 *   - `webhooks[].headers` — operator-supplied webhook auth headers. The
 *     dedicated route (/api/settings/webhooks) already strips these; this one
 *     did not, so the same secrets leaked through the public endpoint.
 *
 * The public key, and every other identity field, is kept: nothing in the app
 * reads `nodeIdentity` out of this response, and the redaction is shaped so a
 * future consumer still sees the object exists.
 */
function redactSettings(settings) {
  const { password, ...safe } = settings;

  if (safe.nodeIdentity && typeof safe.nodeIdentity === "object") {
    const { privateKey, ...identity } = safe.nodeIdentity;
    safe.nodeIdentity = { ...identity, hasPrivateKey: !!privateKey };
  }

  if (Array.isArray(safe.webhooks)) {
    safe.webhooks = safe.webhooks.map(w => {
      if (!w || typeof w !== "object") return w;
      const { headers, ...rest } = w;
      return { ...rest, hasHeaders: !!headers && Object.keys(headers).length > 0 };
    });
  }

  return { safe, password };
}

export async function GET(request) {
  try {
    const settings = await getSettings();
    const { safe: safeSettings, password } = redactSettings(settings);

    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";

    return NextResponse.json({
      ...safeSettings,
      enableRequestLogs,
      hasPassword: !!password
    });
  } catch (error) {
    console.log("Error getting settings:", error);
    return apiError(request, 500, "Failed to load settings");
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    // Block direct credential writes — must go through the newPassword/bcrypt path.
    delete body.password;

    // Treat "no password hash stored yet" as first-run for gating purposes,
    // in addition to the persisted flag. These two can drift apart (e.g. the
    // password field gets cleared/migrated without resetting `firstRun`),
    // which otherwise deadlocks the instance: /login sends the client to
    // /setup based on hasPassword===false, but this gate would keep blocking
    // /setup's own write based on the stale firstRun===false flag, so no
    // authenticated session could ever be created to fix it. Falling back to
    // password-presence keeps the same trust model as real first-run setup
    // (unauthenticated access is only possible while no password exists).
    const flagFirstRun = await getFirstRun();
    const noPasswordStored = !(await getSettings()).password;
    const firstRun = flagFirstRun || noPasswordStored;

    // Auth gate: allow unauthenticated only during the initial setup wizard
    // (firstRun) AND only for the password pair. See FIRST_RUN_ALLOWED_KEYS —
    // the bypass used to cover every writable key, so an anonymous caller could
    // disable login before setup completed.
    const bodyKeys = Object.keys(body);
    const firstRunBypassApplies =
      firstRun && bodyKeys.length > 0 && bodyKeys.every(k => FIRST_RUN_ALLOWED_KEYS.has(k));
    if (!firstRunBypassApplies && !(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }

    // Field allowlist: reject unknown keys so typos and injection attempts fail
    // fast rather than silently writing arbitrary settings keys.
    const unknownKeys = Object.keys(body).filter(k => !PATCH_ALLOWED_KEYS.has(k));
    if (unknownKeys.length > 0) {
      return apiError(request, 400, `Unknown settings field(s): ${unknownKeys.join(", ")}`);
    }

    // Role gate: writing any system/security-sensitive field requires an admin+
    // user-account role (superadmin|admin). Own-profile/cosmetic fields and the
    // firstRun setup wizard are exempt so single-user + initial-setup flows are
    // unchanged. (firstRun already bypassed the auth gate above.)
    // (The first-run exemption is now the narrow password-pair bypass, not the
    // whole of firstRun — otherwise an anonymous caller on an open-mode install
    // could still set system keys before setup completed. The wizard only ever
    // sends {newPassword} here and then logs in, so nothing in it is affected.)
    const touchesSystemKeys = Object.keys(body).some(k => PATCH_SYSTEM_KEYS.has(k));
    if (touchesSystemKeys && !firstRunBypassApplies) {
      const settings = await getSettings();
      // Open mode (login disabled): preserve existing open behaviour by treating
      // the caller as superadmin — mirrors checkAuth()/requireRole() semantics so
      // single-user installs are never locked out of their own system settings.
      const effectiveRole = settings.requireLogin === false
        ? USER_ROLES.SUPERADMIN
        : (await getSessionClaims())?.role;
      if (!hasUserRole(effectiveRole, USER_ROLES.ADMIN)) {
        return apiError(request, 403, "Forbidden: admin role required to change system settings");
      }
    }

    // If updating password, hash it
    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;

      // During setup (firstRun), allow setting password without currentPassword
      if (firstRun) {
        // Initial setup: no current password needed
      } else if (currentHash) {
        // Post-setup: require current password to change
        if (!body.currentPassword) {
          return apiError(request, 400, "Current password required");
        }
        const isValid = await bcrypt.compare(body.currentPassword, currentHash);
        if (!isValid) {
          return apiError(request, 401, "Invalid current password");
        }
      } else {
        // No hash yet, not first run: allow if INITIAL_PASSWORD matches (env bootstrap)
        // This is also a recovery path — the setup wizard should have set a password,
        // but if the DB was cleared or migrated this lets the user recover via /setup.
        const initialPassword = process.env.INITIAL_PASSWORD;
        const envPassword = typeof initialPassword === "string" ? initialPassword.trim() : "";
        const current = typeof body.currentPassword === "string" ? body.currentPassword.trim() : "";
        if (current && envPassword && current !== envPassword) {
          return apiError(request, 401, "Invalid current password");
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(body.newPassword, salt);
      delete body.newPassword;
      delete body.currentPassword;
    }

    const settings = await updateSettings(body);

    // Non-blocking audit log write
    writeAuditLog({ action: 'settings_change', resourceType: 'settings' });

    // Sync pricing to Sidecar if pricePer1k was updated
    if (body.pricePer1k !== undefined) {
      try {
        // pricePer1k is in ZIP, Sidecar expects base_price_per_token (also in ZIP/token)
        // Assuming 1k tokens = 1 unit of pricePer1k
        // So base_price_per_token = pricePer1k / 1000
        const basePrice = body.pricePer1k / 1000;

        const { fetchSidecarWithTimeout } = await import("@/lib/sidecar.js");
        await fetchSidecarWithTimeout("/node/pricing", 5000, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_price_per_token: basePrice,
            min_price_per_token: basePrice * 0.5, // Simple logic
            congestion_multiplier: 1.0
          })
        });
      } catch (err) {
        console.error("Failed to sync pricing to Sidecar:", err);
        // Don't fail the request, just log error
      }
    }

    // Same redaction as GET — PATCH echoes the settings back, so it is the
    // same disclosure path (see redactSettings).
    return NextResponse.json(redactSettings(settings).safe);
  } catch (error) {
    console.log("Error updating settings:", error);
    return apiError(request, 500, "Failed to update settings");
  }
}
