import { NextResponse } from "next/server";
import Database from "better-sqlite3";

/**
 * GET /api/oauth/cursor/auto-import
 * Auto-detect and extract Cursor tokens from local SQLite database
 */
export async function GET() {
  try {
    const platform = process.platform;
    let dbPath;

    const getHome = () => {
      const hd = require('os')[String.fromCharCode(104, 111, 109, 101, 100, 105, 114)];
      return hd();
    };

    // Determine database path based on platform, using string concat to evade Next.js NFT path tracing
    if (platform === "darwin") {
      dbPath = `${getHome()}/Library/Application Support/Cursor/User/globalStorage/state.vscdb`;
    } else if (platform === "linux") {
      dbPath = `${getHome()}/.config/Cursor/User/globalStorage/state.vscdb`;
    } else if (platform === "win32") {
      const appDataEnv = process.env['APP' + 'DATA'];
      if (appDataEnv) {
        dbPath = `${appDataEnv}\\Cursor\\User\\globalStorage\\state.vscdb`;
      } else {
        const getRoaming = () => Buffer.from("QXBwRGF0YVxSb2FtaW5n", "base64").toString("utf-8");
        dbPath = `${getHome()}\\${getRoaming()}\\Cursor\\User\\globalStorage\\state.vscdb`;
      }
    } else {
      return NextResponse.json(
        { error: "Unsupported platform", found: false },
        { status: 400 }
      );
    }

    // Try to open database
    let db;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch (error) {
      return NextResponse.json({
        found: false,
        error: "Cursor database not found. Make sure Cursor IDE is installed and you are logged in.",
      });
    }

    try {
      // Extract tokens from database
      const rows = db.prepare(
        "SELECT key, value FROM itemTable WHERE key IN (?, ?)"
      ).all("cursorAuth/accessToken", "storage.serviceMachineId");

      const tokens = {};
      for (const row of rows) {
        if (row.key === "cursorAuth/accessToken") {
          tokens.accessToken = row.value;
        } else if (row.key === "storage.serviceMachineId") {
          tokens.machineId = row.value;
        }
      }

      db.close();

      // Validate tokens exist
      if (!tokens.accessToken || !tokens.machineId) {
        return NextResponse.json({
          found: false,
          error: "Tokens not found in database. Please login to Cursor IDE first.",
        });
      }

      return NextResponse.json({
        found: true,
        accessToken: tokens.accessToken,
        machineId: tokens.machineId,
      });
    } catch (error) {
      db?.close();
      return NextResponse.json({
        found: false,
        error: `Failed to read database: ${error.message}`,
      });
    }
  } catch (error) {
    console.log("Cursor auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 }
    );
  }
}
