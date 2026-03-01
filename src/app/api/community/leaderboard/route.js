import { NextResponse } from "next/server";
import { getUsageHistory } from "@/lib/usageDb.js";
import { getRoutingPlaybooks } from "@/lib/localDb.js";

export async function GET() {
  try {
    const [history, playbooks] = await Promise.all([getUsageHistory(), getRoutingPlaybooks()]);
    const modelVotes = new Map();

    for (const row of history) {
      const key = row.canonicalModelId || row.model || "unknown";
      const existing = modelVotes.get(key) || {
        modelId: key,
        usageCount: 0,
        providers: new Set(),
      };
      existing.usageCount += 1;
      existing.providers.add(row.provider || "unknown");
      modelVotes.set(key, existing);
    }

    const modelLeaderboard = Array.from(modelVotes.values())
      .map((entry) => ({
        modelId: entry.modelId,
        usageCount: entry.usageCount,
        providers: Array.from(entry.providers),
        confidence: entry.usageCount >= 50 ? "high" : entry.usageCount >= 10 ? "medium" : "low",
      }))
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 25);

    const playbookLeaderboard = (playbooks || [])
      .map((playbook) => ({
        id: playbook.id,
        name: playbook.name,
        isActive: playbook.isActive !== false,
        priority: Number(playbook.priority || 0),
        confidence: "local_only",
      }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 25);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      source: "local",
      models: modelLeaderboard,
      playbooks: playbookLeaderboard,
    });
  } catch (error) {
    console.error("Error building community leaderboard:", error);
    return NextResponse.json({ error: "Failed to build leaderboard" }, { status: 500 });
  }
}

