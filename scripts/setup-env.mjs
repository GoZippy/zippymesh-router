#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

const args = process.argv.slice(2);
const force = args.some((a) => a === "--force");
const passwordArg = args.find((a) => a.startsWith("--password="));
let password = passwordArg ? passwordArg.split("=")[1] : null;

// Determine OS User Data Dir
function getUserDataDir() {
  const appName = process.env.ZIPPY_APP_NAME || "zippy-mesh";
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, appName);
  }
  return path.join(os.homedir(), `.${appName}`);
}

const dataDir = getUserDataDir();
const configPath = path.join(dataDir, "router-config.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let osConfig = {};
if (fs.existsSync(configPath)) {
  try {
    osConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    console.warn("Failed to parse OS config.");
  }
}

let configModified = false;
if (!osConfig.JWT_SECRET) {
  osConfig.JWT_SECRET = crypto.randomBytes(32).toString("hex");
  configModified = true;
}
if (!osConfig.INITIAL_PASSWORD) {
  osConfig.INITIAL_PASSWORD = password || "admin";
  configModified = true;
} else if (password && osConfig.INITIAL_PASSWORD !== password) {
  osConfig.INITIAL_PASSWORD = password;
  configModified = true;
}

if (configModified) {
  fs.writeFileSync(configPath, JSON.stringify(osConfig, null, 2), "utf8");
  console.log(`[Setup] Generated/updated secrets in ${configPath}`);
} else {
  console.log(`[Setup] Loaded existing persistent secrets from ${configPath}`);
}

// Write to .env
if (fs.existsSync(envPath) && !force) {
  // Update existing .env
  let content = fs.readFileSync(envPath, "utf8");
  if (!content.includes("JWT_SECRET=")) {
    content += `\nJWT_SECRET=${osConfig.JWT_SECRET}`;
  } else {
    content = content.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${osConfig.JWT_SECRET}`);
  }
  fs.writeFileSync(envPath, content, "utf8");
  console.log("[Setup] Updated existing .env with persistent JWT_SECRET.");
} else {
  // Create new from example or template
  let content = fs.existsSync(examplePath)
    ? fs.readFileSync(examplePath, "utf8")
    : `JWT_SECRET=REPLACE_ME\nINITIAL_PASSWORD=REPLACE_ME\nDATA_DIR=./data\n`;
  
  content = content
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${osConfig.JWT_SECRET}`)
    .replace(/^INITIAL_PASSWORD=.*$/m, `INITIAL_PASSWORD=${osConfig.INITIAL_PASSWORD}`);
  
  fs.writeFileSync(envPath, content, "utf8");
  console.log("[Setup] Created new .env with persistent secrets.");
}
