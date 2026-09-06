/**
 * Node module-customization hooks that teach plain `node` the two path
 * aliases the Next/webpack build already understands.
 *
 * Why this exists: `src/mcp/zmlr-server.js` and everything it pulls in
 * (`src/lib/discovery/*`, `src/lib/localDb.js`, `src/shared/constants/*`)
 * import through `@/...`. Next resolves that from `jsconfig.json`
 * (`"@/*" -> "./src/*"`, `"open-sse/*" -> "./open-sse/*"`); plain Node does
 * not, so `node -e 'import("./src/mcp/zmlr-server.js")'` fails with
 * ERR_MODULE_NOT_FOUND. That is the whole reason "run ZMLR as a stdio MCP
 * server" was not runnable. These hooks close the gap without touching a
 * single application file.
 *
 * Registered by `scripts/mcp-stdio.mjs` via `module.register()` (Node >= 20.6),
 * so users run `node scripts/mcp-stdio.mjs` with no extra flags. It can also be
 * used ad hoc:
 *
 *   node --import ./src/mcp/stdio/register.mjs <your-script.mjs>
 *
 * Resolution mimics the bundler alias, which is extension-optional and
 * directory-index aware: `@/lib/localDb` -> `<repo>/src/lib/localDb.js`,
 * `@/lib/discovery` -> `<repo>/src/lib/discovery/index.js`.
 *
 * Hooks run on their own thread, so only sync `fs` and the `data` payload
 * handed to `initialize()` are available here — no shared module state.
 */

import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Extensions tried, in order, when a specifier has none (matches the webpack alias). */
const EXTENSIONS = [".js", ".mjs", ".cjs", ".json", ".jsx", ".ts", ".tsx"];

/** Repo root, supplied by `register(..., { data })`; falls back to this file's location. */
let repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

/** Alias table, rebuilt whenever `repoRoot` is known. Longest prefix wins. */
let aliases = [];

function buildAliases(root) {
  return [
    { prefix: "@/", target: path.join(root, "src") },
    { prefix: "open-sse/", target: path.join(root, "open-sse") },
    { exact: "open-sse", target: path.join(root, "open-sse") },
  ];
}

aliases = buildAliases(repoRoot);

/**
 * Called once on the hooks thread with whatever `register()` passed as `data`.
 * @param {{ repoRoot?: string }} [data]
 */
export async function initialize(data) {
  if (data && typeof data.repoRoot === "string" && data.repoRoot) {
    repoRoot = path.resolve(data.repoRoot);
    aliases = buildAliases(repoRoot);
  }
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Turn an aliased filesystem path into a concrete file, the way the bundler
 * alias does: exact file, then `+ ext`, then `dir/index + ext`.
 * @returns {string|null} absolute file path, or null when nothing matches
 */
export function resolveAliasedPath(basePath) {
  if (isFile(basePath)) return basePath;

  for (const ext of EXTENSIONS) {
    const candidate = basePath + ext;
    if (isFile(candidate)) return candidate;
  }

  // A `.js` specifier that only exists as `.ts`/`.tsx` (TS-style rewriting).
  const ext = path.extname(basePath);
  if (ext === ".js" || ext === ".mjs") {
    const stem = basePath.slice(0, -ext.length);
    for (const alt of [".ts", ".tsx", ".jsx"]) {
      if (isFile(stem + alt)) return stem + alt;
    }
  }

  if (isDirectory(basePath)) {
    for (const indexExt of EXTENSIONS) {
      const candidate = path.join(basePath, "index" + indexExt);
      if (isFile(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Map an aliased specifier to an absolute file path, or null when the
 * specifier is not aliased (in which case Node's default resolution applies).
 * Exported for the unit test; the hook below is the real consumer.
 */
export function mapSpecifier(specifier) {
  for (const alias of aliases) {
    if (alias.exact !== undefined) {
      if (specifier === alias.exact) return resolveAliasedPath(alias.target);
      continue;
    }
    if (specifier.startsWith(alias.prefix)) {
      const rest = specifier.slice(alias.prefix.length);
      // Reject traversal that would escape the alias target.
      const joined = path.resolve(alias.target, rest);
      const rel = path.relative(alias.target, joined);
      if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
      return resolveAliasedPath(joined);
    }
  }
  return null;
}

/**
 * `resolve` hook. Non-aliased specifiers fall straight through to
 * `nextResolve`, so normal node_modules / relative / builtin resolution is
 * untouched.
 */
export async function resolve(specifier, context, nextResolve) {
  const mapped = mapSpecifier(specifier);
  if (mapped) {
    return {
      url: pathToFileURL(mapped).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
