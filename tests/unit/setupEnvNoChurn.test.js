/**
 * scripts/setup-env.mjs — the operator's `.env` is authoritative.
 *
 * THE BUG (adversarial review 2026-08-30 — security/install slice, H-7): the
 * sync loop passed `keepExisting = false` for JWT_SECRET and SIDE_CAR_SECRET and
 * replaced them unconditionally with router-config.json's values. The script
 * runs as BOTH `predev` and `prebuild`, so any divergence — a hand-edit, a
 * backup restore, an `.env` copied between machines — meant every
 * `npm run dev` / `npm run build` silently rewrote the operator's `.env`,
 * invalidating every dashboard session and making the running sidecar's shared
 * bearer start 401ing until restart. It then printed
 * "Skipped: JWT_SECRET (already present)" — which meant "already present in
 * router-config.json" and read as the exact opposite of what had happened. It
 * also contradicted the file's own docstring: "must never churn the operator's
 * `.env`".
 *
 * The script is driven as a real child process against a scratch repo layout,
 * with DATA_DIR pointed at a throwaway directory, so nothing here can touch the
 * operator's real `.env` or `%APPDATA%\zippy-mesh`.
 *
 * Run ONLY: npx vitest run tests/unit/setupEnvNoChurn.test.js
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SCRIPT = path.join(REPO, "scripts", "setup-env.mjs");

const A = "a".repeat(64); // the operator's .env value
const B = "b".repeat(64); // router-config.json's, deliberately different

let tmp;

/**
 * A scratch "repo root" holding just `.env` + `.env.example`, plus a scratch
 * DATA_DIR holding `router-config.json`. setup-env.mjs resolves the repo root
 * from its own location, so the script is copied in beside a `scripts/` dir.
 */
function fixture({ env, config }) {
  const dir = fs.mkdtempSync(path.join(tmp, "case-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, "scripts", "setup-env.mjs"));
  fs.writeFileSync(path.join(dir, ".env.example"), "JWT_SECRET=\nSIDE_CAR_SECRET=\nAPI_KEY_SECRET=\n");
  if (env !== null) fs.writeFileSync(path.join(dir, ".env"), env);

  const dataDir = path.join(dir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  if (config) fs.writeFileSync(path.join(dataDir, "router-config.json"), JSON.stringify(config, null, 2));

  return { dir, dataDir };
}

function run({ dir, dataDir }) {
  const stdout = execFileSync(process.execPath, [path.join(dir, "scripts", "setup-env.mjs")], {
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: "utf8",
  });
  return {
    stdout,
    env: fs.existsSync(path.join(dir, ".env")) ? fs.readFileSync(path.join(dir, ".env"), "utf8") : null,
    config: JSON.parse(fs.readFileSync(path.join(dataDir, "router-config.json"), "utf8")),
  };
}

const valueOf = (envText, key) => envText.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1] ?? null;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zmlr-setupenv-"));
});

afterAll(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("an existing .env with diverging secrets", () => {
  const diverged = {
    env: `JWT_SECRET=${A}\nSIDE_CAR_SECRET=${A}\nAPI_KEY_SECRET=${A}\nMY_OWN_SETTING=keep-me\n`,
    config: { JWT_SECRET: B, SIDE_CAR_SECRET: B, API_KEY_SECRET: B, INITIAL_PASSWORD: "pw" },
  };

  it("REGRESSION: does not overwrite the operator's JWT_SECRET", () => {
    const f = fixture(diverged);
    const r = run(f);
    expect(valueOf(r.env, "JWT_SECRET")).toBe(A);
  });

  it("REGRESSION: does not overwrite the operator's SIDE_CAR_SECRET either", () => {
    const f = fixture(diverged);
    const r = run(f);
    expect(valueOf(r.env, "SIDE_CAR_SECRET")).toBe(A);
  });

  it("leaves API_KEY_SECRET alone, as it already did", () => {
    const f = fixture(diverged);
    const r = run(f);
    expect(valueOf(r.env, "API_KEY_SECRET")).toBe(A);
  });

  it("does not churn .env at all — byte-identical afterwards", () => {
    const f = fixture(diverged);
    const before = fs.readFileSync(path.join(f.dir, ".env"), "utf8");
    const r = run(f);
    expect(r.env).toBe(before);
    expect(r.env).toContain("MY_OWN_SETTING=keep-me");
  });

  it("reconciles router-config.json TOWARD .env, and says so", () => {
    const f = fixture(diverged);
    const r = run(f);
    expect(r.config.JWT_SECRET).toBe(A);
    expect(r.config.SIDE_CAR_SECRET).toBe(A);
    expect(r.config.API_KEY_SECRET).toBe(A);
    expect(r.stdout).toMatch(/Your \.env wins/);
    expect(r.stdout).toMatch(/JWT_SECRET/);
    // The old, misleading claim must not be what the operator reads.
    expect(r.stdout).not.toMatch(/Synced JWT_SECRET/);
  });

  it("does not report 'already present', which meant router-config and read as '.env untouched'", () => {
    const f = fixture(diverged);
    const r = run(f);
    expect(r.stdout).not.toMatch(/already present/);
  });

  it("is idempotent — a second run changes nothing further", () => {
    const f = fixture(diverged);
    run(f);
    const envAfterFirst = fs.readFileSync(path.join(f.dir, ".env"), "utf8");
    const cfgAfterFirst = fs.readFileSync(path.join(f.dataDir, "router-config.json"), "utf8");

    const second = run(f);
    expect(second.env).toBe(envAfterFirst);
    expect(fs.readFileSync(path.join(f.dataDir, "router-config.json"), "utf8")).toBe(cfgAfterFirst);
  });
});

describe("an .env with empty or missing lines is still filled in", () => {
  it("fills an empty JWT_SECRET= line — the .env.example default", () => {
    const f = fixture({
      env: "JWT_SECRET=\nAPI_KEY_SECRET=\n",
      config: { JWT_SECRET: B, SIDE_CAR_SECRET: B, API_KEY_SECRET: B, INITIAL_PASSWORD: "pw" },
    });
    const r = run(f);
    expect(valueOf(r.env, "JWT_SECRET")).toBe(B);
    expect(valueOf(r.env, "API_KEY_SECRET")).toBe(B);
    // SIDE_CAR_SECRET had no line at all — one is appended.
    expect(valueOf(r.env, "SIDE_CAR_SECRET")).toBe(B);
    expect(r.config.JWT_SECRET).toBe(B); // no divergence to reconcile
  });

  it("generates the secrets when router-config.json does not exist yet", () => {
    const f = fixture({ env: "JWT_SECRET=\n", config: null });
    const r = run(f);
    expect(valueOf(r.env, "JWT_SECRET")).toMatch(/^[0-9a-f]{64}$/);
    expect(r.config.JWT_SECRET).toBe(valueOf(r.env, "JWT_SECRET"));
  });
});
