import { NextResponse } from "next/server";
import { getSidecarUrl } from "@/lib/sidecar";

export const dynamic = "force-dynamic";

/**
 * GET /api/node/status
 *
 * Live-probes the sidecar /health endpoint on every request.
 * Does NOT rely on any in-memory singleton or nodeProcess variable —
 * this survives HMR and process restarts cleanly.
 *
 * Returns:
 *   200  { online: true,  version: string }   — sidecar responded OK
 *   200  { online: false, error?: string }     — sidecar unreachable or timed out
 */
export async function GET() {
  const sidecarUrl = getSidecarUrl();

  try {
    const res = await fetch(`${sidecarUrl}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2000),
    });

    if (res.ok) {
      let version = "unknown";
      try {
        const body = await res.json();
        version = body?.version ?? body?.node_version ?? "unknown";
      } catch {
        // /health may return plain text or empty body — that's fine
      }
      return NextResponse.json({ online: true, version });
    }

    return NextResponse.json({ online: false, error: `HTTP ${res.status}` });
  } catch (err) {
    const isTimeout =
      err?.name === "TimeoutError" || err?.name === "AbortError";
    return NextResponse.json({
      online: false,
      error: isTimeout ? "timeout" : err?.message ?? "unreachable",
    });
  }
}
