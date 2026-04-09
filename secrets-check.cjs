#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const scanDirs = [path.join(root, "src"), path.join(root, "open-sse")];
const ignoreDirs = new Set(["node_modules", ".next", ".cache", "dist", "build"]);

const suspiciousPatterns = [
  { name: "hardcoded clientSecret", regex: /\bclientSecret\s*:\s*["'`]([^"'`]+)["'`]/g },
  { name: "hardcoded clientSecret assignment", regex: /\bclientSecret\s*=\s*["'`]([^"'`]+)["'`]/g },
  { name: "openai key", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "google api key", regex: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { name: "gocspx secret", regex: /GOCSPX-[A-Za-z0-9_-]{8,}/g },
];

const allowedTokens = ["REDACTED_IN_SOURCE", "REDACTED", "PLACEHOLDER", "your-", "${", "process.env"];

function walkFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || ignoreDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(js|mjs|ts|json|md|env)$/.test(fullPath)) continue;
    files.push(fullPath);
  }
  return files;
}

function hasAllowedSecret(token) {
  return allowedTokens.some((allowed) => token.includes(allowed));
}

function scanForSecrets() {
  const findings = [];
  for (const rootDir of scanDirs) {
    if (!fs.existsSync(rootDir)) continue;
    for (const filePath of walkFiles(rootDir)) {
      const rel = path.relative(root, filePath);
      const text = fs.readFileSync(filePath, "utf8");
      for (const pattern of suspiciousPatterns) {
        for (const match of text.matchAll(pattern.regex)) {
          const token = match[0];
          if (hasAllowedSecret(token)) continue;
          const line = text.slice(0, match.index).split(/\r?\n/).length;
          findings.push({ file: rel, line, token: token.slice(0, 24), name: pattern.name });
        }
      }
    }
  }

  if (!findings.length) {
    return true;
  }

  console.error("[secrets-check] Potential hardcoded secret found in tracked source files.");
  for (const item of findings) {
    console.error(` - ${item.file}:${item.line} (${item.name})`);
  }
  return false;
}

if (!scanForSecrets()) {
  process.exit(1);
}

