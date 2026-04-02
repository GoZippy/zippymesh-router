# ZMLR-Lite — Lightweight API Experiment

**Purpose:** Compare Hono vs Next.js for API-heavy workloads. Proof-of-concept for a faster, lighter alternative.

## Why Next.js?

ZMLR uses Next.js for:

- **Full-stack:** API routes + dashboard in one repo
- **Tauri:** Desktop app via `@tauri-apps/*` (Tauri embeds Next.js frontend)
- **Convention:** App Router, file-based routing

## Critical Next.js Drawbacks for ZMLR

| Issue | Impact |
|-------|--------|
| **No socket access** | App Router `Request` doesn't expose `socket.remoteAddress` → requires `x-real-ip` or `"unknown"` fallback |
| **Heavy runtime** | ~15K+ deps, Next.js build, large `node_modules` |
| **Cold starts** | Slow on serverless; slower than Hono/Fastify on Node |
| **Overkill** | 130+ API routes in a single Next.js app; most are pure API, not SSR |
| **Build complexity** | `next build` + webpack; standalone output is large |

## Why Hono + Bun/Node?

| Benefit | Hono | Next.js |
|---------|------|---------|
| **Bundle size** | ~14KB | ~2MB+ (with React) |
| **Socket access** | `req.raw.socket.remoteAddress` | Not exposed |
| **Cold start** | Minimal | Slower |
| **Compile to binary** | Yes (Bun) | No |
| **Multi-runtime** | Node, Bun, Deno, Cloudflare, Lambda | Node (Vercel) |
| **API-first** | Native | Via App Router |

## Platform-Specific Compiled Apps

- **Bun:** `bun build ./src/index.js --compile --outfile=zmlr-lite` → single binary
- **Cross-compile:** `--target=bun-linux-x64`, `bun-windows-x64`, `bun-darwin-arm64`
- **Tauri:** Keep for desktop GUI; Tauri can spawn a Hono backend as a sidecar or run the API in the same process

## Run

```bash
# Node (no Bun required)
cd experiments/zmlr-lite && npm install && npm run dev

# Bun (faster)
bun install && bun run src/index.js
```

Port: **20129** (avoids ZMLR's 20128)

## Test

```bash
curl http://localhost:20129/api/health
curl http://localhost:20129/api/v1/models
curl -X POST http://localhost:20129/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d @test-payload.json
# Or inline (PowerShell: use different quoting):
# -d '{"model":"zippymesh/Fast-Code","messages":[{"role":"user","content":"hi"}]}'
```

## Migration Path (If Adopted)

1. **Phase 1:** Run Hono API alongside Next.js; proxy chat to Hono for A/B comparison
2. **Phase 2:** Migrate API routes incrementally; keep Next.js for dashboard only

3. **Phase 3:** Dashboard → Vite + React (or keep Next.js for dashboard only; API fully on Hono)

4. **Desktop:** Tauri + Hono backend (spawn Hono binary or embed API in Tauri process)

## Trade-offs

- **Lose:** Next.js file-based routing, built-in SSR for dashboard
- **Gain:** Direct socket IP, faster cold starts, smaller binary, compile-to-executable option
