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
    // Runs before each test file's own imports, so DATA_DIR/JWT_SECRET are set
    // before anything can import src/lib/localDb.js (which resolves + creates
    // its data dir at module-import time). Keeps `npx vitest run tests/unit/`
    // from ever touching the operator's real %APPDATA%\zippy-mesh store.
    // See docs/_internal/KIROCREW_INTEGRATION_HANDOFF.md §4/§7.
    setupFiles: ["./tests/unit/_setup/dataDir.mjs"],
    include: ["tests/unit/**/*.{test,spec}.{js,ts}", "src/**/*.{test,spec}.{js,ts}"],
    exclude: ["**/node_modules/**", "**/community-dist/**", "**/.next/**", "**/.claude/worktrees/**", "tests/e2e/**"],
  },
});
