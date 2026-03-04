import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const PROVIDERS_DIR = path.join(process.cwd(), "public", "providers");
const DEFAULT_ICON = "openrouter.png"; // Generic gateway icon as fallback

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
    return NextResponse.json({ error: "Invalid provider id" }, { status: 400 });
  }

  const iconPath = path.join(PROVIDERS_DIR, `${id}.png`);
  const defaultPath = path.join(PROVIDERS_DIR, DEFAULT_ICON);

  try {
    const targetPath = fs.existsSync(iconPath) ? iconPath : defaultPath;
    const buffer = fs.readFileSync(targetPath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "Icon not found" }, { status: 404 });
  }
}
