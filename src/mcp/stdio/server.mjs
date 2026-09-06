/**
 * ZMLR MCP server over the stdio transport.
 *
 * Transport (per the MCP spec): newline-delimited UTF-8 JSON-RPC 2.0 messages
 * on stdin/stdout. stdout carries protocol traffic ONLY — every log line goes
 * to stderr (see `./stdoutGuard.mjs`). Messages contain no embedded newlines
 * because `JSON.stringify` escapes them.
 *
 * This is the process behind the README's "add ZMLR as an MCP server in Claude
 * Code / Cursor" story. It wraps the same `zmlrMCPServer.handlers` that
 * `/api/mcp` exposes over HTTP, so the two transports cannot drift.
 *
 * Auth: handlers are invoked with NO context, which is the documented signal
 * for the in-process/stdio path — the vault tools then read the agent token
 * from `ZIPPYVAULT_TOKEN` (see `vaultTokenFrom()` in `../zmlr-server.js`).
 *
 * Entry point: `scripts/mcp-stdio.mjs`.
 */

import { protectStdout, writeMessage } from "./stdoutGuard.mjs";
import { makeVaultProxy } from "./vaultProxy.mjs";

/** Spec revisions this server speaks. Same tools/list + tools/call shapes. */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

/** Offered when the client asks for something we do not recognise. */
export const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

/** JSON-RPC 2.0 error codes. */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

/** Refuse absurd input rather than buffering it; a real message is tiny. */
const MAX_LINE_BYTES = 8 * 1024 * 1024;

function log(...args) {
  process.stderr.write(`[zmlr-mcp-stdio] ${args.join(" ")}\n`);
}

/**
 * Negotiate the protocol version: echo the client's when we speak it,
 * otherwise offer our default and let the client decide whether to continue.
 */
export function negotiateProtocolVersion(requested) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : DEFAULT_PROTOCOL_VERSION;
}

/**
 * MCP `tools/list` entries built from `zmlrMCPServer.tools`.
 *
 * Every tool in `zmlr-server.js` currently ships a real JSON Schema; the
 * `{ type: "object" }` fallback exists so a future tool added without one
 * still lists (clients reject a tool whose `inputSchema` is absent) instead of
 * breaking discovery for all of them. Tools with a handler but no definition
 * are surfaced too, for the same reason.
 *
 * A tool that `zmlr-server.js` marks `mutating` (it changes state or spends the
 * operator's money) is published with `annotations.readOnlyHint: false` — the
 * signal MCP clients use when deciding whether a call may be auto-approved. The
 * internal flag itself is not echoed.
 */
export function buildToolList(server) {
  const defined = Array.isArray(server.tools) ? server.tools : [];
  const seen = new Set();
  const tools = [];

  for (const tool of defined) {
    if (!tool || typeof tool.name !== "string") continue;
    seen.add(tool.name);
    tools.push({
      name: tool.name,
      description: tool.description || "",
      inputSchema: tool.inputSchema || { type: "object" },
      ...(tool.mutating && { annotations: { readOnlyHint: false, openWorldHint: true } }),
    });
  }

  for (const name of Object.keys(server.handlers || {})) {
    if (seen.has(name)) continue;
    tools.push({
      name,
      description: "",
      inputSchema: { type: "object" },
    });
  }

  return tools;
}

/** Wrap a handler's `{ success, ... }` result in an MCP tool result. */
export function toToolResult(result) {
  return {
    content: [{ type: "text", text: JSON.stringify(result ?? null) }],
    isError: result?.success === false,
  };
}

function errorResponse(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data !== undefined && { data }) },
  };
}

function okResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

/**
 * Build the request dispatcher.
 *
 * @param {object} server — `zmlrMCPServer`
 * @param {object} [opts]
 * @param {object|null} [opts.vaultProxy] — when set, vault_* calls are routed
 *   to a running ZMLR HTTP server instead of this process's own vault library
 *   (see `./vaultProxy.mjs` and the unlock-scope note in docs/MCP_STDIO.md).
 * @returns {(msg: object) => Promise<object|null>} — resolves to the response
 *   to send, or null for a notification.
 */
export function createDispatcher(server, opts = {}) {
  const handlers = server.handlers || {};
  const vaultProxy = opts.vaultProxy || null;

  async function callTool(name, args) {
    if (vaultProxy && vaultProxy.handles(name)) {
      return vaultProxy.call(name, args);
    }
    // No context argument: that is what tells the vault tools to read
    // ZIPPYVAULT_TOKEN from the environment rather than expecting a header.
    return handlers[name](args);
  }

  return async function dispatch(msg) {
    if (msg === null || typeof msg !== "object" || Array.isArray(msg)) {
      return errorResponse(null, RPC.INVALID_REQUEST, "Invalid Request: expected a JSON-RPC object");
    }

    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;

    if (typeof method !== "string") {
      return isNotification
        ? null
        : errorResponse(id, RPC.INVALID_REQUEST, "Invalid Request: 'method' must be a string");
    }

    switch (method) {
      case "initialize": {
        if (isNotification) return null;
        const requested = params?.protocolVersion;
        return okResponse(id, {
          protocolVersion: negotiateProtocolVersion(requested),
          capabilities: { tools: {} },
          serverInfo: {
            name: server.name || "zmlr",
            version: server.version || "0.0.0",
          },
          ...(server.description && { instructions: server.description }),
        });
      }

      case "notifications/initialized":
      case "initialized":
      case "notifications/cancelled":
      case "notifications/progress":
        return null;

      case "ping":
        return isNotification ? null : okResponse(id, {});

      case "tools/list": {
        if (isNotification) return null;
        return okResponse(id, { tools: buildToolList(server) });
      }

      case "tools/call": {
        if (isNotification) return null;

        const name = params?.name;
        if (typeof name !== "string" || !name) {
          return errorResponse(id, RPC.INVALID_PARAMS, "Invalid params: 'name' must be a non-empty string");
        }
        if (typeof handlers[name] !== "function") {
          return errorResponse(id, RPC.INVALID_PARAMS, `Unknown tool: ${name}`, {
            available: Object.keys(handlers),
          });
        }

        const args = params.arguments ?? {};
        if (args === null || typeof args !== "object" || Array.isArray(args)) {
          return errorResponse(id, RPC.INVALID_PARAMS, "Invalid params: 'arguments' must be an object");
        }

        // Mirror the HTTP route: fire the lifecycle hooks so existing
        // instrumentation keeps working. Their console.log output is already
        // redirected to stderr by the stdout guard.
        if (server.hooks?.beforeToolCall) {
          try {
            await server.hooks.beforeToolCall(name, args);
          } catch (err) {
            log("beforeToolCall hook threw:", err?.message ?? String(err));
          }
        }

        let result;
        try {
          result = await callTool(name, args);
        } catch (err) {
          if (server.hooks?.onError) {
            try {
              await server.hooks.onError(err, name);
            } catch { /* a failing error hook must not mask the error */ }
          }
          return errorResponse(id, RPC.INTERNAL_ERROR, `Tool '${name}' threw: ${err?.message ?? String(err)}`);
        }

        if (server.hooks?.afterToolCall) {
          try {
            await server.hooks.afterToolCall(name, args, result ?? {});
          } catch (err) {
            log("afterToolCall hook threw:", err?.message ?? String(err));
          }
        }

        return okResponse(id, toToolResult(result));
      }

      default:
        return isNotification
          ? null
          : errorResponse(id, RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  };
}

/**
 * Run the stdio loop.
 *
 * Requests are dispatched concurrently (each line starts a promise that is not
 * awaited); responses are written one whole line at a time, so a slow tool call
 * never blocks a `ping` behind it and no two responses interleave.
 *
 * @param {object} server — `zmlrMCPServer`
 * @param {object} [opts]
 * @param {NodeJS.ReadableStream} [opts.input] — defaults to process.stdin
 * @returns {Promise<void>} resolves when stdin ends
 */
export function runStdioServer(server, opts = {}) {
  const input = opts.input || process.stdin;
  const vaultProxy = opts.vaultProxy !== undefined ? opts.vaultProxy : makeVaultProxy(process.env);
  const dispatch = createDispatcher(server, { vaultProxy });

  if (vaultProxy) {
    log(`vault_* tools proxy to ${vaultProxy.baseUrl} (ZMLR_URL is set)`);
  }

  let buffer = "";
  const inFlight = new Set();

  function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (err) {
      writeMessage(errorResponse(null, RPC.PARSE_ERROR, `Parse error: ${err.message}`));
      return;
    }

    const task = dispatch(msg)
      .then((response) => {
        if (response) writeMessage(response);
      })
      .catch((err) => {
        // A dispatcher bug, not a tool failure. Never let it kill the loop.
        log("dispatch failed:", err?.stack ?? String(err));
        const id = msg && typeof msg === "object" ? (msg.id ?? null) : null;
        if (id !== null) {
          writeMessage(errorResponse(id, RPC.INTERNAL_ERROR, `Internal error: ${err?.message ?? String(err)}`));
        }
      })
      .finally(() => inFlight.delete(task));

    inFlight.add(task);
  }

  return new Promise((resolve) => {
    input.setEncoding("utf8");

    input.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE_BYTES) {
        writeMessage(errorResponse(null, RPC.PARSE_ERROR, "Parse error: message exceeds size limit"));
        buffer = "";
        return;
      }
      let newlineAt;
      while ((newlineAt = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineAt);
        buffer = buffer.slice(newlineAt + 1);
        handleLine(line);
      }
    });

    const finish = async () => {
      if (buffer.trim()) handleLine(buffer);
      buffer = "";
      // Let anything still running answer before the process goes away.
      await Promise.allSettled([...inFlight]);
      resolve();
    };

    input.on("end", finish);
    input.on("close", finish);
    input.on("error", (err) => {
      log("stdin error:", err?.message ?? String(err));
      finish();
    });
  });
}

/**
 * Boot the server: guard stdout, import the tool definitions, run the loop.
 * Called by `scripts/mcp-stdio.mjs` after the alias loader is registered.
 */
export async function main() {
  protectStdout();

  // Imported dynamically so the stdout guard is already in place if anything
  // in the application graph logs at module-evaluation time.
  const { zmlrMCPServer } = await import("../zmlr-server.js");

  log(`${zmlrMCPServer.name} v${zmlrMCPServer.version} ready on stdio (${zmlrMCPServer.tools.length} tools)`);

  await runStdioServer(zmlrMCPServer);
  log("stdin closed, exiting");
}
