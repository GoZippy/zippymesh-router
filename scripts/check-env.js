#!/usr/bin/env node
/**
 * check-env.js
 *
 * Checks whether required OAuth app-level secrets are present in the environment.
 * Warns when a provider's client secret is missing and prints actionable guidance.
 *
 * Usage: node scripts/check-env.js
 *        npm run check-env
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Load .env if present (simple key=value parser, no dependencies) ──────────
function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadDotEnv();

// ── Determine which OAuth providers are configured in the local DB ────────────
function getConfiguredProviders() {
  const dataDir =
    process.env.DATA_DIR ||
    (() => {
      const appName = process.env.ZIPPY_APP_NAME || "zippy-mesh";
      if (process.platform === "win32") {
        return path.join(
          process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"),
          appName
        );
      }
      return path.join(process.env.HOME || "~", `.${appName}`);
    })();

  const dbPath = path.join(dataDir, "db.json");
  if (!fs.existsSync(dbPath)) {
    // Also check the local ./data directory (default DATA_DIR=./data in .env.example)
    const localDb = path.join(ROOT, "data", "db.json");
    if (fs.existsSync(localDb)) {
      return parseDbProviders(localDb);
    }
    return new Set();
  }
  return parseDbProviders(dbPath);
}

function parseDbProviders(dbPath) {
  const found = new Set();
  try {
    const raw = fs.readFileSync(dbPath, "utf8");
    const db = JSON.parse(raw);
    // Connections are typically under db.connections or db.providers
    const connections =
      db?.connections ||
      db?.providers ||
      (Array.isArray(db) ? db : null) ||
      [];
    const list = Array.isArray(connections) ? connections : Object.values(connections);
    for (const conn of list) {
      const provider =
        conn?.provider ||
        conn?.providerName ||
        conn?.type ||
        "";
      if (provider) found.add(provider.toLowerCase());
    }
  } catch {
    // DB not readable or not yet created — silently skip
  }
  return found;
}

// ── Secret check definitions ──────────────────────────────────────────────────
const OAUTH_SECRETS = [
  {
    envVar: "ANTIGRAVITY_CLIENT_SECRET",
    providers: ["antigravity"],
    label: "Antigravity (Google Gemini Code Assist)",
  },
  {
    envVar: "GEMINI_CLIENT_SECRET",
    providers: ["gemini", "gemini-cli"],
    label: "Gemini / Gemini CLI",
  },
  {
    envVar: "IFLOW_CLIENT_SECRET",
    providers: ["iflow"],
    label: "iFlow",
  },
];

function isUsable(val) {
  if (typeof val !== "string") return false;
  const v = val.trim().toUpperCase();
  return v.length > 0 && !v.includes("REDACTED") && !v.includes("PLACEHOLDER");
}

// ── Run checks ────────────────────────────────────────────────────────────────
const configuredProviders = getConfiguredProviders();
const hasDb = configuredProviders.size > 0;

let warnings = 0;
let configured = 0;

console.log("\n=== ZippyMesh OAuth App-Level Secret Check ===\n");

for (const { envVar, providers, label } of OAUTH_SECRETS) {
  const val = process.env[envVar];
  const secretOk = isUsable(val);

  // Only warn if a relevant provider is known to be configured, or if we
  // have no DB info yet (first-run guidance).
  const providerActive = providers.some((p) => configuredProviders.has(p));
  const shouldWarn = !secretOk && (providerActive || !hasDb);

  if (secretOk) {
    configured++;
    console.log(`  [OK]  ${label}`);
    console.log(`        ${envVar} is set.\n`);
  } else if (shouldWarn) {
    warnings++;
    console.warn(`  [WARN] ${label}`);
    console.warn(`         ${envVar} is not set (or is a placeholder).`);
    console.warn(`         OAuth flows for ${providers.join(" / ")} will not work until this is configured.`);
    console.warn(`         To fix: add the following line to your .env file:`);
    console.warn(`\n           ${envVar}=<your-secret-here>\n`);
    console.warn(`         See docs/oauth-setup.md for how to obtain this value.\n`);
  } else {
    // Secret missing but provider not configured — informational only
    console.log(`  [--]  ${label}`);
    console.log(`        ${envVar} not set (provider not currently active).\n`);
  }
}

if (warnings === 0) {
  console.log("All required OAuth app-level secrets appear to be configured.\n");
} else {
  console.warn(
    `${warnings} warning(s) found. Set the missing secret(s) in your .env file and restart.\n`
  );
  process.exitCode = 1;
}
