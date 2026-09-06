/**
 * MCP stdio transport — process-level tests.
 *
 * These spawn the real `scripts/mcp-stdio.mjs` and speak JSON-RPC over its
 * stdin/stdout, because the two things most likely to break are exactly the
 * things an in-process test cannot see:
 *   1. the `@/` path aliases resolving under plain Node (the gap this runner
 *      closes — Next resolves them, `node` does not), and
 *   2. stdout staying free of log output. `zmlr-server.js` hooks and
 *      `localDb.js` both `console.log`; one stray line corrupts the stream and
 *      the client drops the connection.
 *
 * DATA_DIR is always a throwaway directory: importing the server pulls in
 * `src/lib/localDb.js`, which runs SQLite migrations against whatever store
 * DATA_DIR names (see the handoff §4 / §7 working rules).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VAULT_TOKEN_ENV } from "../../src/mcp/zmlr-server.js";
import {
  buildToolList,
  toToolResult,
  negotiateProtocolVersion,
  createDispatcher,
  DEFAULT_PROTOCOL_VERSION,
  RPC,
} from "../../src/mcp/stdio/server.mjs";
import { mapSpecifier } from "../../src/mcp/stdio/loader.mjs";
import { makeVaultProxy, createVaultProxy } from "../../src/mcp/stdio/vaultProxy.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTRY = path.join(REPO_ROOT, "scripts", "mcp-stdio.mjs");

/** Whole-suite budget: one spawn pays the import cost, every test reuses it. */
const BOOT_TIMEOUT_MS = 30_000;

// ── A single long-lived server, driven by a tiny JSON-RPC client ─────────────

/**
 * Spawn the stdio server and return a client over it. One process for the
 * whole file: the import graph (SQLite, discovery catalog) costs ~1 s and
 * re-paying it per test would blow the time budget.
 */
function startServer(extraEnv = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "zmlr-mcp-stdio-"));

  const child = spawn(process.execPath, [ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      JWT_SECRET: randomBytes(32).toString("hex"),
      ZIPPY_OFFLINE: "true",
      // Never inherit the operator's token; each test states its own intent.
      [VAULT_TOKEN_ENV]: "",
      ZMLR_URL: "",
      ...extraEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdoutRaw = "";
  let stderrRaw = "";
  let buffer = "";
  let nextId = 1;
  const pending = new Map();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutRaw += chunk;
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line); // a non-JSON line here IS the bug
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderrRaw += chunk; });

  function send(method, params, { id = nextId++ } = {}) {
    const promise = new Promise((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`timeout waiting for ${method} (id ${id})`));
      }, 20_000).unref?.();
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params && { params }) }) + "\n");
    return promise;
  }

  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params && { params }) }) + "\n");
  }

  /** Send a raw line (for parse-error coverage) and await the id-less reply. */
  function sendRaw(line) {
    const promise = new Promise((resolve, reject) => {
      pending.set(null, resolve);
      setTimeout(() => {
        if (pending.delete(null)) reject(new Error("timeout waiting for raw reply"));
      }, 20_000).unref?.();
    });
    child.stdin.write(line + "\n");
    return promise;
  }

  const exited = new Promise((resolve) => child.on("close", resolve));

  return {
    child,
    dataDir,
    send,
    notify,
    sendRaw,
    exited,
    get stdoutRaw() { return stdoutRaw; },
    get stderrRaw() { return stderrRaw; },
    async stop() {
      child.stdin.end();
      const code = await exited;
      try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows lock */ }
      return code;
    },
  };
}

describe("MCP stdio transport (spawned process)", () => {
  let server;

  beforeAll(async () => {
    server = startServer();
    // Prove the process boots and the `@/` aliases resolved, before anything else.
    const res = await server.send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "0" },
    });
    expect(res.result).toBeDefined();
    server.notify("notifications/initialized");
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (server) await server.stop();
  }, 15_000);

  it("initialize echoes a supported protocol version and advertises the tools capability", async () => {
    const res = await server.send("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
    expect(res.jsonrpc).toBe("2.0");
    expect(res.result.protocolVersion).toBe("2024-11-05");
    expect(res.result.capabilities).toMatchObject({ tools: {} });
    expect(res.result.serverInfo).toMatchObject({ name: "zmlr" });
    expect(typeof res.result.serverInfo.version).toBe("string");
  });

  it("initialize falls back to the default version for an unknown revision", async () => {
    const res = await server.send("initialize", { protocolVersion: "1999-01-01", capabilities: {} });
    expect(res.result.protocolVersion).toBe(DEFAULT_PROTOCOL_VERSION);
  });

  it("ping answers with an empty result", async () => {
    const res = await server.send("ping");
    expect(res.result).toEqual({});
  });

  it("tools/list returns every handler with a name, description and inputSchema", async () => {
    const res = await server.send("tools/list");
    const tools = res.result.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThanOrEqual(10);

    for (const tool of tools) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
    }

    const names = tools.map((t) => t.name);
    for (const expected of ["list_models", "recommend_model", "vault_status", "vault_list", "vault_get", "vault_store"]) {
      expect(names).toContain(expected);
    }
  });

  it("tools/call runs a real handler through the @/ alias graph", async () => {
    const res = await server.send("tools/call", { name: "vault_status", arguments: {} });
    expect(res.result.isError).toBe(false);
    expect(res.result.content).toHaveLength(1);
    expect(res.result.content[0].type).toBe("text");

    const payload = JSON.parse(res.result.content[0].text);
    expect(payload.success).toBe(true);
    // A fresh DATA_DIR: nothing has unlocked this process's vault.
    expect(payload.unlocked).toBe(false);
  });

  it("tools/call omits the context, so vault tools use the ZIPPYVAULT_TOKEN path and fail clearly without one", async () => {
    const res = await server.send("tools/call", { name: "vault_list", arguments: {} });
    // A missing token is a TOOL error, not a protocol error: the client sees
    // isError with an actionable message rather than a dead connection.
    expect(res.error).toBeUndefined();
    expect(res.result.isError).toBe(true);

    const payload = JSON.parse(res.result.content[0].text);
    expect(payload).toMatchObject({ success: false, requires_token: true });
    expect(payload.error).toContain(VAULT_TOKEN_ENV);
    expect(payload).not.toHaveProperty("value");
  });

  it("tools/call defaults missing arguments to an empty object", async () => {
    const res = await server.send("tools/call", { name: "vault_status" });
    expect(res.result.isError).toBe(false);
  });

  it("an unknown method is -32601", async () => {
    const res = await server.send("totally/unknown");
    expect(res.error.code).toBe(RPC.METHOD_NOT_FOUND);
  });

  it("a malformed tools/call is -32602", async () => {
    const missingName = await server.send("tools/call", { arguments: {} });
    expect(missingName.error.code).toBe(RPC.INVALID_PARAMS);

    const unknownTool = await server.send("tools/call", { name: "definitely_not_a_tool", arguments: {} });
    expect(unknownTool.error.code).toBe(RPC.INVALID_PARAMS);
    expect(unknownTool.error.data.available).toContain("list_models");

    const badArgs = await server.send("tools/call", { name: "vault_status", arguments: [1, 2] });
    expect(badArgs.error.code).toBe(RPC.INVALID_PARAMS);
  });

  it("unparseable input is -32700 with a null id and does not kill the loop", async () => {
    const res = await server.sendRaw("{ this is not json");
    expect(res.id).toBe(null);
    expect(res.error.code).toBe(RPC.PARSE_ERROR);

    // The server is still answering afterwards.
    expect((await server.send("ping")).result).toEqual({});
  });

  it("notifications get no response", async () => {
    server.notify("notifications/initialized");
    server.notify("notifications/cancelled", { requestId: 1 });
    // If either produced a response the next id-matched read would desync;
    // a clean round-trip proves they did not.
    expect((await server.send("ping")).result).toEqual({});
  });

  it("concurrent requests all answer and every response is a complete line", async () => {
    const results = await Promise.all([
      server.send("ping"),
      server.send("tools/list"),
      server.send("tools/call", { name: "vault_status", arguments: {} }),
      server.send("ping"),
      server.send("tools/call", { name: "get_models_by_capability", arguments: { capability: "code", limit: 2 } }),
    ]);
    expect(results).toHaveLength(5);
    for (const r of results) expect(r.error).toBeUndefined();
  }, 25_000);

  it("stdout carries ONLY JSON lines; all logging went to stderr", () => {
    const lines = server.stdoutRaw.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(JSON.parse(line).jsonrpc).toBe("2.0");
    }
    // The server banner and the localDb migration chatter are the proof that
    // logging happened at all -- and that it landed on the other stream.
    expect(server.stderrRaw).toContain("zmlr-mcp-stdio");
    expect(server.stdoutRaw).not.toContain("[zmlr-mcp-stdio]");
    expect(server.stdoutRaw).not.toContain("[ZMLR MCP]");
  });
});

describe("MCP stdio: clean shutdown", () => {
  it("exits 0 when stdin ends", async () => {
    const s = startServer();
    const res = await s.send("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    expect(res.result.serverInfo.name).toBe("zmlr");
    expect(await s.stop()).toBe(0);
  }, BOOT_TIMEOUT_MS);
});

// ── Unit-level coverage of the pieces the process test cannot isolate ────────

describe("path alias loader", () => {
  it("maps @/ to src/ and resolves an extensionless specifier", () => {
    expect(mapSpecifier("@/lib/vault.js")).toBe(path.join(REPO_ROOT, "src", "lib", "vault.js"));
    // `@/lib/localDb` (no extension) is how catalogService imports it.
    expect(mapSpecifier("@/lib/localDb")).toBe(path.join(REPO_ROOT, "src", "lib", "localDb.js"));
    expect(mapSpecifier("@/shared/constants/models")).toBe(
      path.join(REPO_ROOT, "src", "shared", "constants", "models.js"),
    );
  });

  it("resolves a directory to its index file", () => {
    expect(mapSpecifier("@/shared/constants")).toBe(
      path.join(REPO_ROOT, "src", "shared", "constants", "index.js"),
    );
  });

  it("maps open-sse subpaths", () => {
    expect(mapSpecifier("open-sse/config/providerModels.js")).toBe(
      path.join(REPO_ROOT, "open-sse", "config", "providerModels.js"),
    );
  });

  it("leaves non-aliased specifiers to Node", () => {
    expect(mapSpecifier("node:fs")).toBe(null);
    expect(mapSpecifier("./relative.js")).toBe(null);
    expect(mapSpecifier("lowdb")).toBe(null);
  });

  it("refuses traversal out of the alias target", () => {
    expect(mapSpecifier("@/../package.json")).toBe(null);
  });

  it("returns null for an alias that does not exist on disk", () => {
    expect(mapSpecifier("@/definitely/not/here.js")).toBe(null);
  });
});

describe("tool list and result shaping", () => {
  it("synthesises an object schema for a tool defined without one", () => {
    const tools = buildToolList({
      tools: [{ name: "no_schema", description: "d" }],
      handlers: { no_schema: () => {} },
    });
    expect(tools).toEqual([{ name: "no_schema", description: "d", inputSchema: { type: "object" } }]);
  });

  it("publishes readOnlyHint:false for a mutating tool and no annotations otherwise", () => {
    const tools = buildToolList({
      tools: [
        { name: "reads", description: "", inputSchema: { type: "object" } },
        { name: "spends", description: "", inputSchema: { type: "object" }, mutating: true },
      ],
      handlers: { reads: () => {}, spends: () => {} },
    });
    expect(tools[0]).not.toHaveProperty("annotations");
    expect(tools[1].annotations).toEqual({ readOnlyHint: false, openWorldHint: true });
    // The internal flag never reaches the wire.
    expect(tools[1]).not.toHaveProperty("mutating");
  });

  it("still lists a handler that has no tool definition", () => {
    const tools = buildToolList({ tools: [], handlers: { orphan: () => {} } });
    expect(tools).toEqual([{ name: "orphan", description: "", inputSchema: { type: "object" } }]);
  });

  it("flags isError from the handler's success field only", () => {
    expect(toToolResult({ success: true, a: 1 })).toEqual({
      content: [{ type: "text", text: '{"success":true,"a":1}' }],
      isError: false,
    });
    expect(toToolResult({ success: false, error: "nope" }).isError).toBe(true);
    // No `success` field at all is not an error.
    expect(toToolResult({ anything: 1 }).isError).toBe(false);
    expect(toToolResult(undefined)).toEqual({ content: [{ type: "text", text: "null" }], isError: false });
  });

  it("negotiates the protocol version", () => {
    expect(negotiateProtocolVersion("2025-06-18")).toBe("2025-06-18");
    expect(negotiateProtocolVersion("2024-11-05")).toBe("2024-11-05");
    expect(negotiateProtocolVersion(undefined)).toBe(DEFAULT_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion("2030-01-01")).toBe(DEFAULT_PROTOCOL_VERSION);
  });
});

describe("dispatcher", () => {
  const fakeServer = {
    name: "fake",
    version: "9.9.9",
    tools: [{ name: "ok", description: "", inputSchema: { type: "object" } }],
    handlers: {
      ok: async (input) => ({ success: true, echo: input }),
      boom: async () => { throw new Error("kaboom"); },
    },
  };

  it("calls the handler with exactly one argument so the env-token path is used", async () => {
    let argCount = -1;
    const dispatch = createDispatcher({
      ...fakeServer,
      handlers: { probe: async (...args) => { argCount = args.length; return { success: true }; } },
    });
    await dispatch({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "probe", arguments: {} } });
    expect(argCount).toBe(1);
  });

  it("turns a handler throw into -32603", async () => {
    const dispatch = createDispatcher(fakeServer);
    const res = await dispatch({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "boom", arguments: {} } });
    expect(res.error.code).toBe(RPC.INTERNAL_ERROR);
    expect(res.error.message).toContain("kaboom");
  });

  it("returns null for notifications and rejects a non-object message", async () => {
    const dispatch = createDispatcher(fakeServer);
    expect(await dispatch({ jsonrpc: "2.0", method: "notifications/initialized" })).toBe(null);
    expect((await dispatch([])).error.code).toBe(RPC.INVALID_REQUEST);
    expect((await dispatch(null)).error.code).toBe(RPC.INVALID_REQUEST);
  });

  it("routes vault tools to the proxy when one is supplied, and leaves the rest alone", async () => {
    const calls = [];
    const proxy = {
      baseUrl: "http://x",
      handles: (n) => n.startsWith("vault_"),
      call: async (n, a) => { calls.push([n, a]); return { success: true, via: "proxy" }; },
    };
    const dispatch = createDispatcher(
      { ...fakeServer, handlers: { ...fakeServer.handlers, vault_get: async () => ({ success: true, via: "local" }) } },
      { vaultProxy: proxy },
    );

    const proxied = await dispatch({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "vault_get", arguments: { name: "A" } } });
    expect(JSON.parse(proxied.result.content[0].text).via).toBe("proxy");
    expect(calls).toEqual([["vault_get", { name: "A" }]]);

    const local = await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ok", arguments: {} } });
    expect(JSON.parse(local.result.content[0].text).success).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("ZMLR_URL vault proxy", () => {
  it("is off unless ZMLR_URL is set", () => {
    expect(makeVaultProxy({})).toBe(null);
    expect(makeVaultProxy({ ZMLR_URL: "  " })).toBe(null);
    expect(makeVaultProxy({ ZMLR_URL: "http://127.0.0.1:20128" }).baseUrl).toBe("http://127.0.0.1:20128");
  });

  it("rejects a malformed ZMLR_URL loudly", () => {
    expect(() => makeVaultProxy({ ZMLR_URL: "not a url" })).toThrow(/not a valid URL/);
  });

  it("refuses a non-loopback ZMLR_URL unless opted in, and never over cleartext http (H-12)", () => {
    // The token is POSTed in the request body, so an unrestricted ZMLR_URL is a
    // one-env-var exfiltration. Loopback is always allowed.
    expect(makeVaultProxy({ ZMLR_URL: "http://localhost:20128" }).baseUrl).toBe("http://localhost:20128");
    expect(makeVaultProxy({ ZMLR_URL: "http://[::1]:20128" }).baseUrl).toBe("http://[::1]:20128");

    // A non-loopback host without the opt-in is refused before any request.
    expect(() => makeVaultProxy({ ZMLR_URL: "http://10.0.88.254:21999" })).toThrow(/non-loopback host/);
    // With the opt-in but plain http, still refused (cleartext).
    expect(() =>
      makeVaultProxy({ ZMLR_URL: "http://10.0.88.254:21999", ZMLR_ALLOW_REMOTE: "1" }),
    ).toThrow(/cleartext/);
    // Opt-in + https is allowed.
    expect(
      makeVaultProxy({ ZMLR_URL: "https://remote.example:8443", ZMLR_ALLOW_REMOTE: "1" }).baseUrl,
    ).toBe("https://remote.example:8443");
    // A non-http(s) scheme is refused outright.
    expect(() => makeVaultProxy({ ZMLR_URL: "ftp://127.0.0.1" })).toThrow(/must be http/);
  });

  it("uses the same env var name as zmlr-server.js", () => {
    // vaultProxy.mjs keeps its own copy so it can load before the app graph.
    expect(VAULT_TOKEN_ENV).toBe("ZIPPYVAULT_TOKEN");
    const proxy = makeVaultProxy({ ZMLR_URL: "http://127.0.0.1", ZIPPYVAULT_TOKEN: "" });
    return proxy.call("vault_list", {}).then((r) => {
      expect(r).toMatchObject({ success: false, requires_token: true });
      expect(r.error).toContain("ZIPPYVAULT_TOKEN");
    });
  });

  it("handles only the tools the frozen token routes can serve", () => {
    const proxy = makeVaultProxy({ ZMLR_URL: "http://127.0.0.1" });
    expect(proxy.handles("vault_get")).toBe(true);
    expect(proxy.handles("vault_list")).toBe(true);
    expect(proxy.handles("vault_status")).toBe(true);
    // No store-with-token route exists; vault_store stays on the local library.
    expect(proxy.handles("vault_store")).toBe(false);
    expect(proxy.handles("list_models")).toBe(false);
  });

  it("maps a 401 'Vault is locked' to requires_unlock and any other 401 to requires_token", async () => {
    const reply = (status, body) => async () => ({ status, ok: status < 400, json: async () => body });

    const locked = createVaultProxy("http://h", () => "t", reply(401, { ok: false, error: "Vault is locked" }));
    expect(await locked.call("vault_get", { name: "A" })).toMatchObject({ success: false, requires_unlock: true });

    const badToken = createVaultProxy("http://h", () => "t", reply(401, { ok: false, error: "Invalid token" }));
    expect(await badToken.call("vault_get", { name: "A" })).toMatchObject({ success: false, requires_token: true });

    const forbidden = createVaultProxy("http://h", () => "t", reply(403, { ok: false, error: "not scoped" }));
    const res = await forbidden.call("vault_get", { name: "A" });
    expect(res.success).toBe(false);
    expect(res).not.toHaveProperty("requires_token");
  });

  it("explains an unreachable server instead of throwing", async () => {
    const down = createVaultProxy("http://h", () => "t", async () => { throw new Error("ECONNREFUSED"); });
    const res = await down.call("vault_list", {});
    expect(res.success).toBe(false);
    expect(res.error).toContain("Could not reach the ZMLR server");
    expect(res.error).toContain("ZMLR_URL");
  });

  it("requires an entry name before spending a request", async () => {
    let called = 0;
    const proxy = createVaultProxy("http://h", () => "t", async () => { called++; return { status: 200, json: async () => ({}) }; });
    expect(await proxy.call("vault_get", {})).toEqual({ success: false, error: "name is required" });
    expect(called).toBe(0);
  });
});
