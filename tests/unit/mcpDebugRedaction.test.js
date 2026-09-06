/**
 * H-13 — `ZMLR_MCP_DEBUG` must not write decrypted vault secrets to stderr.
 *
 * MCP hosts persist a server's stderr to disk, so the per-tool debug logging in
 * `src/mcp/zmlr-server.js` (fired for every tool through the stdio dispatcher's
 * afterToolCall/beforeToolCall hooks) must redact vault material. These tests
 * cover the pure redactor and drive the real hooks with the debug switch on,
 * asserting the plaintext value never reaches captured stderr.
 *
 * Importing zmlr-server.js pulls in the app graph; DATA_DIR is isolated by the
 * vitest setup file, so nothing touches the operator's real store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { zmlrMCPServer, redactForDebug } from "../../src/mcp/zmlr-server.js";

const SECRET = "sk-SUPER-SECRET-VALUE-9999-should-never-be-logged";

describe("redactForDebug", () => {
  it("redacts value / token / password / apiKey but keeps non-secret fields", () => {
    const out = redactForDebug({
      success: true,
      name: "OPENAI_API_KEY",
      label: "OpenAI",
      category: "api-key",
      value: SECRET,
      token: "zvt-abc-123456",
      password: "hunter2xyz",
      apiKey: "kkkk",
      api_key: "kkkk2",
      private_key: "pem-data-here",
      unlocked: true,
      via: "http://127.0.0.1:20128",
    });
    expect(out.value).toBe("[redacted]");
    expect(out.token).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    expect(out.apiKey).toBe("[redacted]");
    expect(out.api_key).toBe("[redacted]");
    expect(out.private_key).toBe("[redacted]");
    // Non-secret metadata is preserved so debug output stays useful.
    expect(out.name).toBe("OPENAI_API_KEY");
    expect(out.label).toBe("OpenAI");
    expect(out.category).toBe("api-key");
    expect(out.unlocked).toBe(true);
    expect(out.via).toBe("http://127.0.0.1:20128");
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it("redacts entries[].value in a vault_list-shaped result", () => {
    const out = redactForDebug({
      success: true,
      count: 1,
      entries: [{ name: "X", label: "L", category: "api", value: SECRET }],
    });
    expect(out.entries[0].value).toBe("[redacted]");
    expect(out.entries[0].name).toBe("X");
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it("does not mutate the original and survives circular references", () => {
    const original = { value: SECRET, nested: {} };
    original.nested.self = original;
    const out = redactForDebug(original);
    expect(original.value).toBe(SECRET); // untouched
    expect(out.value).toBe("[redacted]");
    expect(out.nested.self).toBe("[circular]");
  });
});

describe("ZMLR_MCP_DEBUG stderr redaction", () => {
  let errSpy;
  let warnSpy;
  let prev;

  beforeEach(() => {
    prev = process.env.ZMLR_MCP_DEBUG;
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    warnSpy.mockRestore();
    if (prev === undefined) delete process.env.ZMLR_MCP_DEBUG;
    else process.env.ZMLR_MCP_DEBUG = prev;
  });

  const captured = () =>
    errSpy.mock.calls
      .map((c) => c.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
      .join("\n");

  it("a vault_get result's plaintext value is absent from debug stderr", async () => {
    process.env.ZMLR_MCP_DEBUG = "true";
    await zmlrMCPServer.hooks.afterToolCall(
      "vault_get",
      { name: "OPENAI_API_KEY" },
      { success: true, name: "OPENAI_API_KEY", label: "OpenAI", category: "api-key", value: SECRET },
    );
    const log = captured();
    expect(log).toContain("[ZMLR MCP] Result:");
    expect(log).toContain("OPENAI_API_KEY"); // non-secret metadata still logged
    expect(log).toContain("[redacted]");
    expect(log).not.toContain(SECRET);
  });

  it("a vault_store input's plaintext value is absent from debug stderr", async () => {
    process.env.ZMLR_MCP_DEBUG = "true";
    await zmlrMCPServer.hooks.beforeToolCall("vault_store", { name: "NEW_KEY", value: SECRET });
    const log = captured();
    expect(log).toContain("[ZMLR MCP] Input:");
    expect(log).not.toContain(SECRET);
  });

  it("ZMLR_MCP_DEBUG=0 does NOT enable logging (the === 'true' gate)", async () => {
    process.env.ZMLR_MCP_DEBUG = "0";
    await zmlrMCPServer.hooks.afterToolCall("vault_get", { name: "X" }, { success: true, value: SECRET });
    const log = captured();
    expect(log).not.toContain("[ZMLR MCP] Result:");
    expect(log).not.toContain(SECRET);
  });
});
