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
    const envPassword = typeof process.env.INITIAL_PASSWORD === "string" ? process.env.INITIAL_PASSWORD.trim() : "";

    let isValid = false;
    if (storedHash) {
      try {
        isValid = await bcrypt.compare(password, storedHash);
      } catch {
        isValid = false;
      }
      if (!isValid && envPassword && password === envPassword) {
        isValid = true;
      }
    } else {
      isValid = envPassword ? password === envPassword : false;
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

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
