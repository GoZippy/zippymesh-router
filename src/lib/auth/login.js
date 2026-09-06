import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import {
  getSettings,
  listUsers,
  getUserByUsername,
  createUser,
} from "@/lib/localDb";

/**
 * Shared HS256 secret for signing/verifying the dashboard JWT.
 *
 * The existing convention (see src/app/api/auth/login/route.js and
 * src/middleware.js) encodes process.env.JWT_SECRET with TextEncoder and signs
 * with HS256 into the `auth_token` cookie. We mirror that exactly so tokens
 * remain cross-compatible with the middleware verifier.
 *
 * We read the env var lazily (per call) rather than freezing it at module load
 * so unit tests can configure JWT_SECRET before exercising the auth helpers
 * without importing the route (which throws at import time when the secret is
 * unset). isAuthenticated() keeps the original `|| ""` fallback behaviour.
 */
function getSecret() {
  return new TextEncoder().encode(process.env.JWT_SECRET || "");
}

const TOKEN_EXPIRATION = "24h";
const TOKEN_ALG = "HS256";

export async function isAuthenticated() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    if (!token) return false;
    const { payload } = await jwtVerify(token, getSecret());
    return payload.authenticated === true;
  } catch (e) {
    return false;
  }
}

/**
 * Sign an `auth_token` JWT from a claim payload.
 * Always stamps `authenticated: true` so the existing middleware /
 * isAuthenticated() checks keep working regardless of the richer claims.
 *
 * @param {object} claims  e.g. { userId, username, role } — `authenticated`
 *                         is forced on and cannot be spoofed away.
 * @returns {Promise<string>} signed compact JWT
 */
export async function signAuthToken(claims = {}) {
  return new SignJWT({ ...claims, authenticated: true })
    .setProtectedHeader({ alg: TOKEN_ALG })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRATION)
    .sign(getSecret());
}

/**
 * Seed a single superadmin user when:
 *   - there are no users yet, AND
 *   - ADMIN_USERNAME and (ADMIN_PASSWORD || SUPERADMIN_PASSWORD) are set.
 *
 * Idempotent + import-safe: it is a no-op when any user already exists, so
 * calling it on every login is harmless. Never invoked at module import time.
 *
 * @returns {Promise<object|null>} the created superadmin (without re-hashing on
 *                                 subsequent calls), or null when no seed ran.
 */
export async function seedSuperadminIfNeeded() {
  const adminUsername =
    typeof process.env.ADMIN_USERNAME === "string"
      ? process.env.ADMIN_USERNAME.trim()
      : "";
  const adminPassword =
    (typeof process.env.ADMIN_PASSWORD === "string" && process.env.ADMIN_PASSWORD) ||
    (typeof process.env.SUPERADMIN_PASSWORD === "string" && process.env.SUPERADMIN_PASSWORD) ||
    "";

  if (!adminUsername || !adminPassword) return null;

  // Idempotency guard #1: only seed into a completely empty users table.
  const existing = await listUsers();
  if (existing.length > 0) return null;

  // Idempotency guard #2: don't collide with a same-named user that may have
  // appeared between the listUsers() check and now (createUser also enforces
  // uniqueness and would throw; we swallow that into a no-op).
  const dup = await getUserByUsername(adminUsername);
  if (dup) return null;

  const password_hash = await bcrypt.hash(adminPassword, 10);
  try {
    return await createUser({
      username: adminUsername,
      password_hash,
      role: "superadmin",
    });
  } catch (e) {
    // Lost a race (unique-username violation) — treat as already-seeded.
    return null;
  }
}

/**
 * Verify a single-password (legacy) credential against the stored bcrypt hash
 * in settings.password, with an optional env INITIAL_PASSWORD recovery
 * override. Mirrors the original route logic so existing behaviour/tests hold.
 *
 * @returns {Promise<{ ok:boolean, usedEnvFallback:boolean, noCredentials:boolean }>}
 */
export async function verifyLegacyPassword(password) {
  const settings = await getSettings();
  const storedHash = settings?.password;

  // env INITIAL_PASSWORD is an optional override — recovery / automated deploys.
  // It is NOT primary storage; primary credential is the bcrypt hash on disk.
  const envPassword =
    typeof process.env.INITIAL_PASSWORD === "string"
      ? process.env.INITIAL_PASSWORD.trim()
      : "";

  let isValid = false;
  let usedEnvFallback = false;

  if (storedHash) {
    try {
      isValid = await bcrypt.compare(password, storedHash);
    } catch {
      isValid = false;
    }
  }

  if (!isValid && envPassword && password === envPassword) {
    isValid = true;
    usedEnvFallback = true;
  }

  const noCredentials = !storedHash && !envPassword;
  return { ok: isValid, usedEnvFallback, noCredentials };
}

/**
 * Core authentication entry point. Decides between the user-table path and the
 * legacy single-password path, and returns a result the route layer turns into
 * a cookie + JSON response. Does NOT touch cookies itself (so it is unit
 * testable without a Next.js request context).
 *
 * Decision:
 *   - If any users exist -> require { username, password }; verify via
 *     getUserByUsername + bcrypt.compare; enforce is_active.
 *     JWT payload = { authenticated, userId, username, role }.
 *   - If NO users exist -> legacy single-password path (unchanged), which keeps
 *     working exactly as before. The legacy owner is treated as superadmin.
 *
 * Seeding (ADMIN_USERNAME/ADMIN_PASSWORD) runs first and is idempotent, so an
 * env-seeded superadmin flips the flow into the user-table path automatically.
 *
 * @param {{username?:string, password?:string}} input
 * @returns {Promise<
 *   | { ok:true, token:string, payload:object, mode:'user'|'legacy', usedEnvFallback?:boolean }
 *   | { ok:false, status:number, error:string, setupRequired?:boolean }
 * >}
 */
export async function authenticate({ username, password } = {}) {
  const pwd = typeof password === "string" ? password.trim() : "";
  const uname = typeof username === "string" ? username.trim() : "";

  if (!pwd) {
    return { ok: false, status: 400, error: "Password is required" };
  }

  // Idempotent, import-safe seed of the env-provided superadmin.
  await seedSuperadminIfNeeded();

  const users = await listUsers();

  if (users.length > 0) {
    // ── User-table path ──────────────────────────────────────────────────
    if (!uname) {
      return { ok: false, status: 400, error: "Username is required" };
    }

    const user = await getUserByUsername(uname);

    // Run a bcrypt compare even when the user is missing to reduce username
    // enumeration via timing. Use a stable dummy hash of a fixed string.
    const hashToCheck =
      user?.password_hash || "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
    let passwordOk = false;
    try {
      passwordOk = await bcrypt.compare(pwd, hashToCheck);
    } catch {
      passwordOk = false;
    }

    if (!user || !passwordOk) {
      return { ok: false, status: 401, error: "Invalid username or password" };
    }

    if (user.is_active === false) {
      return { ok: false, status: 403, error: "Account is disabled" };
    }

    const payload = {
      authenticated: true,
      userId: user.id,
      username: user.username,
      role: user.role,
    };
    const token = await signAuthToken(payload);
    return { ok: true, token, payload, mode: "user" };
  }

  // ── Legacy single-password path (no users exist) ───────────────────────
  const legacy = await verifyLegacyPassword(pwd);

  if (legacy.noCredentials && !legacy.ok) {
    // No credentials anywhere — caller should route to the setup wizard.
    return { ok: false, status: 401, error: "Setup required", setupRequired: true };
  }

  if (!legacy.ok) {
    return { ok: false, status: 401, error: "Invalid password" };
  }

  // Legacy owner is the implicit superadmin of this local-first router.
  const payload = {
    authenticated: true,
    userId: null,
    username: null,
    role: "superadmin",
  };
  const token = await signAuthToken(payload);
  return {
    ok: true,
    token,
    payload,
    mode: "legacy",
    usedEnvFallback: legacy.usedEnvFallback,
  };
}
