import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { cookies } from "next/headers";
import { checkIpRateLimit } from "@/lib/auth/ipRateLimit";

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set. Refusing to start with no secret.");
}
if (process.env.JWT_SECRET.length < 32) {
  throw new Error("FATAL: JWT_SECRET is too short (minimum 32 characters). Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
}
const WEAK_SECRETS = new Set(["secret", "password", "changeme", "default", "jwt_secret", "your_secret_here"]);
if (WEAK_SECRETS.has(process.env.JWT_SECRET.toLowerCase())) {
  throw new Error("FATAL: JWT_SECRET appears to be a default/weak value. Please set a strong random secret.");
}
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS    = 15 * 60 * 1000; // 15 minutes

export async function POST(request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
             || request.headers.get("x-real-ip")
             || "unknown";
    const rl = checkIpRateLimit(`login:${ip}`, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
      );
    }

    const body = await request.json();
    const password = typeof body?.password === "string" ? body.password.trim() : "";
    if (!password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    const settings = await getSettings();
    const storedHash = settings.password;

    // env INITIAL_PASSWORD is an optional override — useful as a recovery path
    // or for automated deployments. It is NOT the primary credential storage.
    // Primary credentials live in the user data dir (~/.zippy-mesh/db.json) as
    // a bcrypt hash, persisting across ZMLR updates independent of .env.
    const envPassword = typeof process.env.INITIAL_PASSWORD === "string"
      ? process.env.INITIAL_PASSWORD.trim()
      : "";

    let isValid = false;
    let usedEnvFallback = false;

    if (storedHash) {
      // Primary path: validate against bcrypt hash in user data dir
      try {
        isValid = await bcrypt.compare(password, storedHash);
      } catch {
        isValid = false;
      }
    }

    // Fallback: env INITIAL_PASSWORD override (recovery / automated deployments)
    // Only used when the primary hash check failed or no hash exists yet.
    if (!isValid && envPassword && password === envPassword) {
      isValid = true;
      usedEnvFallback = true;
    }

    if (!isValid && !storedHash && !envPassword) {
      // No credentials anywhere — redirect to setup wizard
      return NextResponse.json({ error: "Setup required", setupRequired: true }, { status: 401 });
    }

    if (isValid) {
      const token = await new SignJWT({ authenticated: true })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("24h")
        .sign(SECRET);

      const cookieStore = await cookies();
      cookieStore.set("auth_token", token, {
        httpOnly: true,
        secure: false, // Allow HTTP for local network access
        sameSite: "lax",
        path: "/",
      });

      // If authenticated via env fallback (no stored hash), signal the UI to
      // prompt the user to complete setup and store a permanent credential.
      return NextResponse.json({
        success: true,
        ...(usedEnvFallback && { needsPasswordSetup: true })
      });
    }

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
