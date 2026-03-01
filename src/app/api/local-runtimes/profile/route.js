import os from "os";
import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb.js";

function detectFeasibleClasses(totalRamGb) {
  if (totalRamGb >= 64) {
    return ["70b-q4", "32b-q4", "14b-q8", "8b-q8", "7b-q8"];
  }
  if (totalRamGb >= 32) {
    return ["32b-q4", "14b-q8", "8b-q8", "7b-q8", "4b-q8"];
  }
  if (totalRamGb >= 16) {
    return ["14b-q4", "8b-q4", "7b-q4", "4b-q8"];
  }
  return ["8b-q4", "7b-q4", "4b-q4", "2b-q8"];
}

export async function GET() {
  try {
    const cpus = os.cpus() || [];
    const totalRamGb = Number((os.totalmem() / (1024 ** 3)).toFixed(2));
    const runtimeConnections = await getProviderConnections({ isActive: true, isEnabled: true });
    const localRuntimes = runtimeConnections.filter((conn) =>
      ["ollama", "lmstudio", "llamacpp", "llama.cpp", "local"].includes(String(conn.provider).toLowerCase())
    );

    const profile = {
      host: {
        platform: os.platform(),
        arch: os.arch(),
        cpuModel: cpus[0]?.model || "unknown",
        cpuCores: cpus.length,
        totalRamGb,
      },
      runtimes: localRuntimes.map((conn) => ({
        connectionId: conn.id,
        provider: conn.provider,
        name: conn.name || conn.provider,
        metadata: conn.metadata || null,
      })),
      feasibleModelClasses: detectFeasibleClasses(totalRamGb),
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(profile);
  } catch (error) {
    console.error("Error building local runtime profile:", error);
    return NextResponse.json({ error: "Failed to build runtime profile" }, { status: 500 });
  }
}

