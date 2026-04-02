import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors.js";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set.");
}
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export async function POST(request) {
  // Authentication check
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;

    if (!token) {
      return apiError(request, 401, "Unauthorized");
    }

    await jwtVerify(token, SECRET);
  } catch (error) {
    return apiError(request, 401, "Invalid session");
  }

  const response = NextResponse.json({ success: true, message: "Shutting down..." });

  setTimeout(() => {
    process.exit(0);
  }, 500);

  return response;
}

