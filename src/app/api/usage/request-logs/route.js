import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";
import { getSettings } from "@/lib/localDb";

export async function GET() {
  try {
    const settings = await getSettings();

    if (settings.isDemoMode) {
      const now = new Date();
      const formatDate = (date) => {
        const pad = (n) => String(n).padStart(2, "0");
        return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
      };

      const models = ["llama-3.1-70b", "gpt-4o", "claude-3-5-sonnet", "qwen-2.5-coder", "phi-3-mini"];
      const providers = ["GROQ", "OPENAI", "ANTHROPIC", "GITHUB", "LOCAL"];
      const statuses = ["OK", "OK", "OK", "OK", "FAILED", "PENDING"];

      const logs = Array.from({ length: 30 }).map((_, i) => {
        const time = new Date(now.getTime() - i * 45000); // approx index * 45s ago
        const m = models[i % models.length];
        const p = providers[i % providers.length];
        const s = statuses[i % statuses.length];
        const tokensIn = Math.floor(Math.random() * 2000) + 100;
        const tokensOut = s === "OK" ? Math.floor(Math.random() * 4000) + 200 : "-";
        const account = `DemoAcc_${i % 3}`;

        return `${formatDate(time)} | ${m} | ${p} | ${account} | ${tokensIn} | ${tokensOut} | ${s}`;
      });

      return NextResponse.json(logs);
    }

    const logs = await getRecentLogs(200);
    return NextResponse.json(logs);
  } catch (error) {
    console.error("[API ERROR] /api/usage/logs failed:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}

