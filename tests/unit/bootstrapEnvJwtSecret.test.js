/**
 * scripts/bootstrapEnv.cjs#ensureJwtSecret — regression for the adversarial
 * review of 2026-08-30, item 8.
 *
 * THE BUG: `JWT_SECRET` had exactly two generators — scripts/store-bootstrap.cjs
 * (interactive) and scripts/setup-env.mjs (predev/prebuild) — and `scripts/` is
 * not in the release zip. src/middleware.js and src/app/api/auth/login/route.js
 * THROW at module load when it is unset, so a fresh unpack that skipped the
 * interactive script answered HTTP 500 to every request with
 * "FATAL: JWT_SECRET environment variable is not set". Verified against a copy
 * of .next/standalone with its .env removed (a release zip excludes .env):
 * before the fix `GET /api/health` was 500, after it is 200.
 *
 * Same shape as ensureApiKeySecret(): env wins, otherwise persist once in
 * <DATA_DIR>/bootstrap.secret at mode 0600, never rotate.
 *
 * DATA_DIR is a fresh temp dir per test file (tests/unit/_setup/dataDir.mjs),
 * so bootstrap.secret lands there and never in the real store. That setup also
 * sets a JWT_SECRET, so every test here manages process.env.JWT_SECRET itself.
 *
 * Run ONLY: npx vitest run tests/unit/bootstrapEnvJwtSecret.test.js
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const bootstrapEnv = require("../../scripts/bootstrapEnv.cjs");
const rootCopy = require("../../bootstrapEnv.cjs");

const secretFile = () => path.join(process.env.DATA_DIR, "bootstrap.secret");
const ORIGINAL_JWT = process.env.JWT_SECRET;

beforeEach(() => {
  delete process.env.JWT_SECRET;
  fs.rmSync(secretFile(), { force: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  // Other test files in this worker rely on the setup file's JWT_SECRET.
  process.env.JWT_SECRET = ORIGINAL_JWT;
});

describe("ensureJwtSecret()", () => {
  it("generates a 64-hex secret once, persists it, and returns the same value on every later start", () => {
    const first = bootstrapEnv.ensureJwtSecret();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(process.env.JWT_SECRET).toBe(first);
    expect(JSON.parse(fs.readFileSync(secretFile(), "utf8")).JWT_SECRET).toBe(first);

    delete process.env.JWT_SECRET; // simulate a restart
    expect(bootstrapEnv.ensureJwtSecret()).toBe(first);
  });

  it("warns once, naming the file, so a multi-instance operator is not surprised", () => {
    bootstrapEnv.ensureJwtSecret();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn.mock.calls[0][0]).toContain("bootstrap.secret");
    expect(console.warn.mock.calls[0][0]).toContain("JWT_SECRET");

    delete process.env.JWT_SECRET;
    console.warn.mockClear();
    bootstrapEnv.ensureJwtSecret(); // reuse — nothing generated, nothing said
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("never overrides an explicit JWT_SECRET from the environment, and never writes it to disk", () => {
    process.env.JWT_SECRET = "operator-provided-secret-value-0123456789";
    expect(bootstrapEnv.ensureJwtSecret()).toBe("operator-provided-secret-value-0123456789");
    expect(fs.existsSync(secretFile())).toBe(false);
  });

  it("treats an empty JWT_SECRET= line (the .env.example default) as unset", () => {
    process.env.JWT_SECRET = "";
    expect(bootstrapEnv.ensureJwtSecret()).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(secretFile())).toBe(true);
  });

  it("regenerates rather than accept a value the login route would reject as too short", () => {
    // api/auth/login/route.js throws below 32 characters — accepting a short
    // env value here would only move the crash one module later.
    process.env.JWT_SECRET = "tooshort";
    const s = bootstrapEnv.ensureJwtSecret();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(s.length).toBeGreaterThanOrEqual(32);
  });

  it("writes bootstrap.secret at mode 0600 on POSIX", () => {
    bootstrapEnv.ensureJwtSecret();
    if (process.platform === "win32") return; // ACLs, not mode bits
    expect(fs.statSync(secretFile()).mode & 0o777).toBe(0o600);
  });

  it("merges into bootstrap.secret without clobbering API_KEY_SECRET", () => {
    delete process.env.API_KEY_SECRET;
    const apiKeySecret = bootstrapEnv.ensureApiKeySecret();
    const jwt = bootstrapEnv.ensureJwtSecret();
    const onDisk = JSON.parse(fs.readFileSync(secretFile(), "utf8"));
    expect(onDisk.API_KEY_SECRET).toBe(apiKeySecret);
    expect(onDisk.JWT_SECRET).toBe(jwt);

    // ...and the reverse order, plus store-bootstrap.cjs's own rewrite.
    bootstrapEnv.setBootstrapSecrets({ JWT_SECRET: "j".repeat(64), PORT: 20128 });
    const after = JSON.parse(fs.readFileSync(secretFile(), "utf8"));
    expect(after.API_KEY_SECRET).toBe(apiKeySecret);
    expect(after.JWT_SECRET).toBe("j".repeat(64));
  });

  it("injectBootstrapSync() provisions it when no bootstrap.secret exists yet — the fresh-unpack path", () => {
    delete process.env.API_KEY_SECRET;
    expect(fs.existsSync(secretFile())).toBe(false);
    bootstrapEnv.injectBootstrapSync();
    expect(process.env.JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(process.env.API_KEY_SECRET).toMatch(/^[0-9a-f]{64}$/);
  });

  it("injectBootstrapSync() still prefers a bootstrap.secret written by store-bootstrap.cjs", () => {
    bootstrapEnv.setBootstrapSecrets({ JWT_SECRET: "a".repeat(64), PORT: 20128 });
    delete process.env.JWT_SECRET;
    bootstrapEnv.injectBootstrapSync();
    expect(process.env.JWT_SECRET).toBe("a".repeat(64));
  });

  it("repo-root bootstrapEnv.cjs is the same module as the shipped scripts/ copy", () => {
    const a = fs.readFileSync(path.resolve("bootstrapEnv.cjs"), "utf8");
    const b = fs.readFileSync(path.resolve("scripts/bootstrapEnv.cjs"), "utf8");
    expect(a).toBe(b);
    expect(typeof rootCopy.ensureJwtSecret).toBe("function");
  });
});
