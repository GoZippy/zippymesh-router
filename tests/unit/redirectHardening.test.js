/**
 * 2026-08-30 adversarial-verify residuals V-1 / V-3: outbound requests that
 * carry a credential or a vault token must NOT follow an HTTP redirect, so a
 * validated loopback/RFC1918 URL cannot 302 the request onward to a public or
 * cloud-metadata host and exfiltrate what it carries.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { probeLocalRuntime, PROBE_FAILURE } from "../../src/lib/discovery/localDiscovery.js";
import { createVaultProxy } from "../../src/mcp/stdio/vaultProxy.mjs";

afterEach(() => vi.restoreAllMocks());

describe("V-1: the local-runtime probe never follows a redirect", () => {
  it("requests with redirect:'manual' and treats a 3xx as unexpected_status", async () => {
    const seen = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      seen.push({ url, redirect: opts?.redirect });
      // A loopback host that 302-redirects to cloud metadata.
      return { ok: false, status: 302, headers: new Map([["location", "http://169.254.169.254/latest/meta-data/"]]), json: async () => ({}) };
    }));

    const out = await probeLocalRuntime("http://127.0.0.1:11434", "ollama", 1000);
    expect(out.ok).toBe(false);
    expect(out.error).toBe(PROBE_FAILURE.UNEXPECTED_STATUS);
    expect(out.models).toEqual([]);
    // Exactly one request, made with redirect:"manual" — the 302 target is never fetched.
    expect(seen).toHaveLength(1);
    expect(seen[0].redirect).toBe("manual");
    expect(seen[0].url).toContain("127.0.0.1:11434");
  });
});

describe("V-3: the MCP stdio vault proxy never follows a redirect", () => {
  it("passes redirect:'manual' on the request that carries the token", async () => {
    let capturedOpts = null;
    const fetchImpl = vi.fn(async (_url, opts) => {
      capturedOpts = opts;
      return { status: 200, json: async () => ({ ok: true, unlocked: true, entries: [] }) };
    });
    const proxy = createVaultProxy("http://127.0.0.1:20128", () => "tok", fetchImpl);
    const out = await proxy.call("vault_list", {});
    expect(out.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(capturedOpts.redirect).toBe("manual");
  });
});
