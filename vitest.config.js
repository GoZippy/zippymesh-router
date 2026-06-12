import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "open-sse": path.resolve(__dirname, "./open-sse"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.{test,spec}.{js,ts}", "src/**/*.{test,spec}.{js,ts}"],
    exclude: ["**/node_modules/**", "**/community-dist/**", "**/.next/**", "**/.claude/worktrees/**", "tests/e2e/**"],
  },
});
