import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { getSettings } from "@/lib/localDb";

export async function GET() {
  try {
    const settings = await getSettings();

    if (settings.isDemoMode) {
      // Return simulated data for layout validation
      const now = new Date();
      const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
      const currentHourStart = new Date(Math.floor(now.getTime() / 3600000) * 3600000);

      const last10Minutes = Array.from({ length: 10 }).map((_, i) => ({
        requests: Math.floor(Math.random() * 8) + 1,
        promptTokens: Math.floor(Math.random() * 4000) + 500,
        completionTokens: Math.floor(Math.random() * 8000) + 1000,
        cost: Math.random() * 0.04 + 0.005
      }));

      const last24Hours = Array.from({ length: 24 }).map((_, i) => {
        const bucketTime = new Date(currentHourStart.getTime() - (23 - i) * 60 * 60 * 1000);
        return {
          timestamp: bucketTime.toISOString(),
          requests: Math.floor(Math.random() * 100) + 20,
          errors: Math.floor(Math.random() * 3),
          promptTokens: Math.floor(Math.random() * 100000) + 10000,
          completionTokens: Math.floor(Math.random() * 200000) + 20000,
          cost: Math.random() * 0.5 + 0.1
        };
      });

      return NextResponse.json({
        isDemo: true,
        totalRequests: 1245,
        totalPromptTokens: 2450000,
        totalCompletionTokens: 5680000,
        totalCost: 12.45,
        byProvider: {
          "groq": { requests: 450, cost: 0.45 },
          "cerebras": { requests: 320, cost: 0.32 },
          "openai": { requests: 210, cost: 8.42 },
          "anthropic": { requests: 265, cost: 3.26 }
        },
        byModel: {
          "llama-3.1-70b (groq)": { requests: 200, cost: 0.15 },
          "gpt-4o (openai)": { requests: 150, cost: 6.20 },
          "claude-3-5-sonnet (anthropic)": { requests: 120, cost: 2.10 }
        },
        last10Minutes,
        last24Hours,
        activeRequests: [
          { model: "llama-3.1-70b", provider: "groq", account: "Demo Account", count: 1 },
          { model: "gpt-4o", provider: "openai", account: "Production Key", count: 2 }
        ]
      });
    }

    const stats = await getUsageStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}

