#!/usr/bin/env node
/**
 * ZMLR MCP server — stdio transport entry point.
 *
 *   node scripts/mcp-stdio.mjs
 *
 * No flags: the `@/` and `open-sse/` path aliases that `src/mcp/zmlr-server.js`
 * relies on are installed programmatically with `module.register()` (Node
 * >= 20.6) before anything from `src/` is imported. See docs/MCP_STDIO.md for
 * client configuration (Claude Code, Cursor, Kilo/Cline) and the environment
 * variables.
 *
 * Environment:
 *   DATA_DIR          — the ZMLR data directory. MUST match the server whose
 *                       vault you expect to see. Defaults to the per-user store.
 *   ZIPPYVAULT_TOKEN  — scoped ZippyVault agent token for the vault_* tools.
 *   ZMLR_URL          — optional; proxy the vault tools at a running ZMLR
 *                       server so they see ITS unlocked vault.
 *   ZMLR_MCP_DEBUG    — verbose tool logging (to stderr).
 *
 * stdout is the protocol channel. Every log this process emits goes to stderr.
 */

import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REQUIRED_NODE_MAJOR = 20;
const REQUIRED_NODE_MINOR = 6;

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < REQUIRED_NODE_MAJOR || (major === REQUIRED_NODE_MAJOR && minor < REQUIRED_NODE_MINOR)) {
  process.stderr.write(
    `[zmlr-mcp-stdio] Node ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}+ is required ` +
    `(module.register); found ${process.versions.node}.\n`,
  );
  process.exit(1);
}

// Keep the transport alive through a floating rejection or a stray throw in a
// fire-and-forget dispatch: without these, one such error takes down the whole
// stdio server and abandons every in-flight call, and the MCP client just sees
// the connection drop (M-17). Both land on stderr (stdout is the protocol
// channel) and the loop keeps running.
process.on("unhandledRejection", (reason) => {
  const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  process.stderr.write(`[zmlr-mcp-stdio] unhandled rejection (ignored; server continues): ${detail}\n`);
});
process.on("uncaughtException", (err) => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[zmlr-mcp-stdio] uncaught exception (ignored; server continues): ${detail}\n`);
});

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const stdioDir = path.join(repoRoot, "src", "mcp", "stdio");

// 1. Install the path-alias resolve hooks. Must happen before any `@/` import.
register(pathToFileURL(path.join(stdioDir, "loader.mjs")).href, {
  parentURL: import.meta.url,
  data: { repoRoot },
});

// 2. Claim stdout for the protocol before the application graph loads: the MCP
//    server's lifecycle hooks (and anything they pull in) use console.log.
const { protectStdout } = await import(pathToFileURL(path.join(stdioDir, "stdoutGuard.mjs")).href);
protectStdout();

// 3. Run.
const { main } = await import(pathToFileURL(path.join(stdioDir, "server.mjs")).href);

try {
  await main();
  process.exit(0);
} catch (err) {
  process.stderr.write(`[zmlr-mcp-stdio] fatal: ${err?.stack ?? String(err)}\n`);
  process.exit(1);
}
