import { cookies } from "next/headers";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "");

export async function isAuthenticated() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    if (!token) return false;
    const { payload } = await jwtVerify(token, SECRET);
    return payload.authenticated === true;
  } catch (e) {
    return false;
  }
}
