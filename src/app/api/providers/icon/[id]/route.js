import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { apiError } from "@/lib/apiErrors.js";

const PROVIDERS_DIR = path.join(process.cwd(), "public", "providers");
const DEFAULT_ICON = "openrouter.png"; // Generic gateway icon as fallback
// 1x1 transparent PNG when no file exists (avoids 404)
const FALLBACK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

/** Sanitize provider id: alphanumeric, underscore, hyphen only */
function sanitizeId(id) {
  if (!id || typeof id !== "string") return null;
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return safe || null;
}

/**
 * GET /api/providers/icon/[id]
 * Serves provider icon PNG. Returns placeholder when file is missing (avoids 404s).
 */
export async function GET(request, { params }) {
  const id = sanitizeId(params?.id);
  if (!id) {
    return apiError(request, 400, "Invalid provider id");
  }

  const iconPath = path.join(PROVIDERS_DIR, `${id}.png`);
  const defaultPath = path.join(PROVIDERS_DIR, DEFAULT_ICON);

  try {
    const targetPath = fs.existsSync(iconPath) ? iconPath : defaultPath;
    const buffer = fs.existsSync(targetPath)
      ? fs.readFileSync(targetPath)
      : FALLBACK_PNG;
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return new NextResponse(FALLBACK_PNG, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }
}
