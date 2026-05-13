

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";

const execAsync = promisify(exec);

const getOpenClawDir = () => `${os[String.fromCharCode(104, 111, 109, 101, 100, 105, 114)]()}/.openclaw`;
const getOpenClawSettingsPath = () => `${getOpenClawDir()}/openclaw.json`;

// Check if openclaw CLI is installed
const checkOpenClawInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where openclaw" : "which openclaw";
    await execAsync(command);
    return true;
  } catch {
    return false;
  }
};

// Read current settings.json
const readSettings = async () => {
  try {
    const settingsPath = getOpenClawSettingsPath();
    const content = await fs.readFile(settingsPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Check if settings has ZippyMesh config
const hasZippyMeshConfig = (settings) => {
  if (!settings || !settings.models || !settings.models.providers) return false;
  return !!settings.models.providers["zippymesh"];
};

// GET - Check openclaw CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkOpenClawInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        settings: null,
        message: "Open Claw CLI is not installed",
      });
    }

    const settings = await readSettings();

    return NextResponse.json({
      installed: true,
      settings,
      hasZippyMesh: hasZippyMeshConfig(settings),
      settingsPath: getOpenClawSettingsPath(),
    });
  } catch (error) {
    console.log("Error checking openclaw settings:", error);
    return NextResponse.json({ error: "Failed to check openclaw settings" }, { status: 500 });
  }
}

// POST - Update ZippyMesh settings (merge with existing settings)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model } = await request.json();

    if (!baseUrl || !model) {
      return NextResponse.json({ error: "baseUrl and model are required" }, { status: 400 });
    }

    // Validate API key format
    if (!apiKey || typeof apiKey !== "string" || !apiKey.startsWith("sk-")) {
      return NextResponse.json(
        { error: "Invalid API key format (must start with sk-)" },
        { status: 400 }
      );
    }

    // Test the API key with actual ZippyMesh endpoint
    const testUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    try {
      const testResponse = await fetch(`${testUrl}/models`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 5000
      });

      if (!testResponse.ok) {
        return NextResponse.json(
          {
            error: `API key validation failed (HTTP ${testResponse.status})`,
            details: `ZippyMesh returned ${testResponse.status} when testing models endpoint. Check your API key and base URL.`
          },
          { status: 400 }
        );
      }

      const modelsData = await testResponse.json();
      if (!modelsData.data || !Array.isArray(modelsData.data) || modelsData.data.length === 0) {
        console.warn("[openclaw-settings] API key is valid but no models returned from /v1/models");
        // Don't fail on this - the endpoint might be different or models loading
      }

    } catch (testError) {
      console.error("[openclaw-settings] Error testing API key:", testError.message);
      return NextResponse.json(
        {
          error: "Could not validate API key",
          details: `Connection failed: ${testError.message}. Ensure ZippyMesh is running at ${testUrl} and the API key is valid.`
        },
        { status: 500 }
      );
    }

    // API key is valid - proceed with writing config
    const openclawDir = getOpenClawDir();
    const settingsPath = getOpenClawSettingsPath();

    // Ensure directory exists
    await fs.mkdir(openclawDir, { recursive: true });

    // Read existing settings or create new
    let settings = {};
    try {
      const existingSettings = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(existingSettings);
    } catch { /* No existing settings */ }

    // Ensure structure exists
    if (!settings.agents) settings.agents = {};
    if (!settings.agents.defaults) settings.agents.defaults = {};
    if (!settings.agents.defaults.model) settings.agents.defaults.model = {};
    if (!settings.models) settings.models = {};
    if (!settings.models.providers) settings.models.providers = {};

    // Normalize baseUrl to ensure /v1 suffix
    const normalizedBaseUrl = testUrl.endsWith("/v1") ? testUrl : `${testUrl}/v1`;

    // Update agents.defaults.model.primary
    settings.agents.defaults.model.primary = `zippymesh/${model}`;

    // Update models.providers.zippymesh
    settings.models.providers["zippymesh"] = {
      baseUrl: normalizedBaseUrl,
      apiKey: apiKey,
      api: "openai-completions",
      models: [
        {
          id: model,
          name: model.split("/").pop() || model,
        },
      ],
    };

    // Write settings
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    return NextResponse.json({
      success: true,
      message: "Open Claw settings applied successfully!",
      settingsPath,
      validated: true
    });
  } catch (error) {
    console.log("Error updating openclaw settings:", error);
    return NextResponse.json({ error: "Failed to update openclaw settings" }, { status: 500 });
  }
}

// DELETE - Remove ZippyMesh settings only (keep other settings)
export async function DELETE() {
  try {
    const settingsPath = getOpenClawSettingsPath();

    // Read existing settings
    let settings = {};
    try {
      const existingSettings = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(existingSettings);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No settings file to reset",
        });
      }
      throw error;
    }

    // Remove ZippyMesh from models.providers
    if (settings.models && settings.models.providers) {
      delete settings.models.providers["zippymesh"];

      // Remove providers object if empty
      if (Object.keys(settings.models.providers).length === 0) {
        delete settings.models.providers;
      }
    }

    // Reset agents.defaults.model.primary if it uses zippymesh
    if (settings.agents?.defaults?.model?.primary?.startsWith("zippymesh/")) {
      delete settings.agents.defaults.model.primary;
    }

    // Write updated settings
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    return NextResponse.json({
      success: true,
      message: "ZippyMesh settings removed successfully",
    });
  } catch (error) {
    console.log("Error resetting openclaw settings:", error);
    return NextResponse.json({ error: "Failed to reset openclaw settings" }, { status: 500 });
  }
}
