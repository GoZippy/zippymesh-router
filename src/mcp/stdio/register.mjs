/**
 * Side-effect entry point for `node --import`.
 *
 * Registers the `@/` and `open-sse/` resolve hooks (see `./loader.mjs`) so any
 * plain-Node script can import ZMLR application modules:
 *
 *   node --import ./src/mcp/stdio/register.mjs my-script.mjs
 *
 * `scripts/mcp-stdio.mjs` does the same thing programmatically so the MCP
 * server needs no command-line flags.
 */

import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

register(pathToFileURL(path.join(here, "loader.mjs")).href, {
  parentURL: import.meta.url,
  data: { repoRoot },
});

export { repoRoot };
